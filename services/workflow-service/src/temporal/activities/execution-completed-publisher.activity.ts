import {
  activeOrRandomTraceId,
  injectTraceContext,
  startNatsProducerSpan,
} from "@yoizen/observability";
import {
  canonicalByteLength,
  computeIdempotencyKey,
  computePayloadChecksum,
  type EventEnvelope,
  type JsonValue,
  TENANT_HEADER,
} from "@yoizen/shared";
import { connect, type NatsConnection, headers as natsHeaders } from "nats";
import { workflowServiceConfig } from "../../config";

/**
 * Lazy NATS connection — reused across activity invocations to avoid
 * re-handshaking every time a workflow completes. `isClosed()` is
 * checked so a disconnected socket is transparently replaced.
 */
let nc: NatsConnection | null = null;
const encoder = new TextEncoder();

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) {
    return nc;
  }
  nc = await connect({
    servers: workflowServiceConfig.natsUrl,
    name: "workflow-service-execution-publisher",
  });
  return nc;
}

/**
 * Canonical subject for workflow execution completion events.
 * Lands in `INGRESS-<tenant>` per DOCS/messaging/envelope.md §9.3.
 *
 * `workflow-api` binds a durable consumer (`workflow-projector`)
 * filtered on this subject and batches UPSERTs into
 * `workflow_executions`. Keeping the subject deterministic means the
 * projector can be started/stopped independently of the Temporal
 * worker — the events accumulate in JetStream during any outage.
 */
export function buildExecutionCompletedSubject(tenantId: string): string {
  return `evt.${tenantId}.workflow-service.workflow.internal.native.execution_completed.v1`;
}

/**
 * Canonical subject for workflow execution start events. Same
 * `evt.<tenant>.workflow-service.workflow.internal.native.<kind>.v1`
 * family as `buildExecutionCompletedSubject` (TAXONOMY.md rule 19 —
 * keys on producer+domain tokens, kind-agnostic) so `execution_started`
 * rides the same `INGRESS-<tenant>` stream and classifier rule with no
 * extra topology.
 */
export function buildExecutionStartedSubject(tenantId: string): string {
  return `evt.${tenantId}.workflow-service.workflow.internal.native.execution_started.v1`;
}

export interface IPublishExecutionCompletedArgs {
  executionId: string;
  status: string;
  tenantId: string;
  workflowName?: string;
  correlationId?: string;
  causationId?: string | null;
  /** Causal depth for the emitted envelope (triggering event's depth + 1). */
  depth?: number;
}

/**
 * Publishes a `workflow.execution.completed` canonical envelope to
 * `INGRESS-<tenant>`. This is the emit side of the async projection
 * pipeline introduced in Phase 7 of the scale-consumers-10 plan:
 * the Temporal worker no longer writes to Postgres on the hot path.
 * Instead, `WorkflowExecutionProjector` consumes this stream and
 * applies batched UPDATEs to `workflow_executions`.
 *
 * Idempotency: `Nats-Msg-Id = sha256:canonical(payload)` and the
 * payload includes `executionId + status`, so if the Temporal worker
 * retries this activity after a partial success, JetStream's
 * `duplicate_window` on `INGRESS-<tenant>` collapses the duplicates.
 *
 * Idempotency posture verified during the 2026-05-22 stress
 * post-mortem (`post-mortem/POST-MORTEM.md` §P1.3 audit doc):
 * NO CHANGE required — this activity is already safe under
 * Temporal-retry / double-completion scenarios.
 *
 * Accepts both a single-object form and the historical positional
 * signature `(executionId, status, tenantId?, workflowName?)` so
 * existing workflow code can migrate gradually.
 */
export async function publishExecutionCompletedEvent(
  executionId: string,
  status: string,
  tenantId?: string,
  workflowName?: string
): Promise<void>;
export async function publishExecutionCompletedEvent(
  args: IPublishExecutionCompletedArgs
): Promise<void>;
export async function publishExecutionCompletedEvent(
  executionIdOrArgs: string | IPublishExecutionCompletedArgs,
  status?: string,
  tenantId?: string,
  workflowName?: string
): Promise<void> {
  const args: IPublishExecutionCompletedArgs =
    typeof executionIdOrArgs === "string"
      ? ({
          executionId: executionIdOrArgs,
          status: status ?? "UNKNOWN",
          ...(tenantId !== undefined && { tenantId }),
          ...(workflowName !== undefined && { workflowName }),
        } as IPublishExecutionCompletedArgs)
      : executionIdOrArgs;

  if (!args.tenantId) {
    /**
     * Without a tenant we cannot route to `INGRESS-<tenant>`. This is
     * a programming error — every workflow is tenant-scoped — but we
     * log & swallow to preserve the "best-effort" contract the
     * legacy activity had, so the workflow outcome is never masked.
     */
    console.warn(
      `[publishExecutionCompletedEvent] no tenantId for execution=${args.executionId}; ` +
        `skipping event emit`
    );
    return;
  }

  const conn = await getConnection();
  const subject = buildExecutionCompletedSubject(args.tenantId);
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const traceid = activeOrRandomTraceId();

  const payload: Record<string, JsonValue> = {
    executionId: args.executionId,
    status: args.status,
    ...(args.workflowName !== undefined && { workflowName: args.workflowName }),
  };

  const idempotencykey = computeIdempotencyKey(payload);
  const payloadChecksum = computePayloadChecksum(payload);
  const payloadBytes = canonicalByteLength(payload);
  const correlationId = args.correlationId ?? eventId;
  const causationId = args.causationId ?? null;

  const envelope: EventEnvelope = {
    specversion: "1.0",
    id: eventId,
    source: "//workflow-service/execution-status",
    type: "io.yoizen.workflow.execution.completed.v1",
    resource: `tenant/${args.tenantId}/workflow-execution/${args.executionId}`,
    time: now,
    traceid,
    causation_id: causationId,
    correlation_id: correlationId,
    tenant: args.tenantId,
    producer: "workflow-service",
    domain: "workflow",
    channel: "internal",
    provider: "native",
    accountid: "system",
    idempotencykey,
    transport: {
      method: "stream",
      protocol: "internal",
      depth: args.depth ?? 0,
    },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: payloadBytes,
      payload_checksum: payloadChecksum,
      payload,
    },
  };

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, args.tenantId);
  hdrs.set("Nats-Msg-Id", idempotencykey);
  hdrs.set("X-Correlation-Id", correlationId);
  if (causationId) {
    hdrs.set("X-Causation-Id", causationId);
  }
  injectTraceContext(hdrs);

  const { span } = startNatsProducerSpan("workflow-service", subject, hdrs);
  try {
    conn.publish(subject, encoder.encode(JSON.stringify(envelope)), {
      headers: hdrs,
    });
    await conn.flush();
  } finally {
    span.end();
  }

  console.log(
    `[publishExecutionCompletedEvent] published execution=${args.executionId} ` +
      `tenant=${args.tenantId} status=${args.status} subject=${subject} ` +
      `correlation_id=${correlationId} causation_id=${causationId ?? "null"} ` +
      `depth=${envelope.transport.depth}`
  );
}

export interface IPublishExecutionStartedArgs {
  executionId: string;
  /** Temporal workflow id (`<tenant>:<name>:<idempotencyKey|nanoid>`). */
  workflowId: string;
  /** Temporal run id for the current execution attempt. */
  runId: string;
  tenantId: string;
  workflowName?: string;
  correlationId?: string;
  causationId?: string | null;
  /** Causal depth for the emitted envelope (triggering event's depth + 1). */
  depth?: number;
}

/**
 * Publishes a `workflow.execution.started` canonical envelope to
 * `INGRESS-<tenant>`. MIRRORS `publishExecutionCompletedEvent`: same
 * lazy-connected NATS publisher (`getConnection()`), same envelope
 * derivation, same subject-builder pattern (`buildExecutionStartedSubject`),
 * and the SAME publish path (no second NATS client/publish path is
 * introduced — this reuses `getConnection()`/`conn.publish()` above).
 *
 * Closes the gap noted in `manual-loops/workflow-step-events.md` (goal 1):
 * before this event, run duration was only inferable from the first and
 * last events of a run. Paired with `execution_completed` via
 * `tracking.tracked_event_spans`, this gives a `duration_ms` for the
 * workflow execution itself with zero pairing-SQL changes (`_started`/
 * `_completed` naming convention).
 */
export async function publishExecutionStartedEvent(
  args: IPublishExecutionStartedArgs
): Promise<void> {
  if (!args.tenantId) {
    /**
     * Same best-effort posture as publishExecutionCompletedEvent: a
     * missing tenant is a programming error (every workflow is
     * tenant-scoped), but we log & swallow so a telemetry gap never
     * masks the workflow's actual outcome.
     */
    console.warn(
      `[publishExecutionStartedEvent] no tenantId for execution=${args.executionId}; ` +
        `skipping event emit`
    );
    return;
  }

  const conn = await getConnection();
  const subject = buildExecutionStartedSubject(args.tenantId);
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const traceid = activeOrRandomTraceId();

  const payload: Record<string, JsonValue> = {
    executionId: args.executionId,
    workflowId: args.workflowId,
    runId: args.runId,
    ...(args.workflowName !== undefined && { workflowName: args.workflowName }),
  };

  const idempotencykey = computeIdempotencyKey(payload);
  const payloadChecksum = computePayloadChecksum(payload);
  const payloadBytes = canonicalByteLength(payload);
  const correlationId = args.correlationId ?? eventId;
  const causationId = args.causationId ?? null;

  const envelope: EventEnvelope = {
    specversion: "1.0",
    id: eventId,
    source: "//workflow-service/execution-status",
    type: "io.yoizen.workflow.execution.started.v1",
    resource: `tenant/${args.tenantId}/workflow-execution/${args.executionId}`,
    time: now,
    traceid,
    causation_id: causationId,
    correlation_id: correlationId,
    tenant: args.tenantId,
    producer: "workflow-service",
    domain: "workflow",
    channel: "internal",
    provider: "native",
    accountid: "system",
    idempotencykey,
    transport: {
      method: "stream",
      protocol: "internal",
      depth: args.depth ?? 0,
    },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: payloadBytes,
      payload_checksum: payloadChecksum,
      payload,
    },
  };

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, args.tenantId);
  hdrs.set("Nats-Msg-Id", idempotencykey);
  hdrs.set("X-Correlation-Id", correlationId);
  if (causationId) {
    hdrs.set("X-Causation-Id", causationId);
  }
  injectTraceContext(hdrs);

  const { span } = startNatsProducerSpan("workflow-service", subject, hdrs);
  try {
    conn.publish(subject, encoder.encode(JSON.stringify(envelope)), {
      headers: hdrs,
    });
    await conn.flush();
  } finally {
    span.end();
  }

  console.log(
    `[publishExecutionStartedEvent] published execution=${args.executionId} ` +
      `tenant=${args.tenantId} workflowId=${args.workflowId} runId=${args.runId} ` +
      `subject=${subject} correlation_id=${correlationId} ` +
      `causation_id=${causationId ?? "null"} depth=${envelope.transport.depth}`
  );
}
