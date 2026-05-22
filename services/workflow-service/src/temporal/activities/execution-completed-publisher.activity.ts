import {
  connect,
  headers as natsHeaders,
  type NatsConnection,
} from "nats";
import {
  TENANT_HEADER,
  computeIdempotencyKey,
  computePayloadChecksum,
  canonicalByteLength,
  type EventEnvelope,
  type JsonValue,
} from "@yoizen/shared";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { workflowServiceConfig } from "../../config";

/**
 * Lazy NATS connection — reused across activity invocations to avoid
 * re-handshaking every time a workflow completes. `isClosed()` is
 * checked so a disconnected socket is transparently replaced.
 */
let nc: NatsConnection | null = null;
const encoder = new TextEncoder();

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) return nc;
  nc = await connect({
    servers: workflowServiceConfig.natsUrl,
    name: "workflow-service-execution-publisher",
  });
  return nc;
}

/**
 * Canonical subject for workflow execution completion events.
 * Lands in `INGRESS-<tenant>` per wdocs-02 §9.3.
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

export interface IPublishExecutionCompletedArgs {
  executionId: string;
  status: string;
  tenantId: string;
  workflowName?: string;
  correlationId?: string;
  causationId?: string | null;
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
  workflowName?: string,
): Promise<void>;
export async function publishExecutionCompletedEvent(
  args: IPublishExecutionCompletedArgs,
): Promise<void>;
export async function publishExecutionCompletedEvent(
  executionIdOrArgs: string | IPublishExecutionCompletedArgs,
  status?: string,
  tenantId?: string,
  workflowName?: string,
): Promise<void> {
  const args: IPublishExecutionCompletedArgs =
    typeof executionIdOrArgs === "string"
      ? {
          executionId: executionIdOrArgs,
          status: status ?? "UNKNOWN",
          ...(tenantId !== undefined && { tenantId }),
          ...(workflowName !== undefined && { workflowName }),
        } as IPublishExecutionCompletedArgs
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
        `skipping event emit`,
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
    transport: { method: "stream", protocol: "internal", depth: 0 },
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
  if (causationId) hdrs.set("X-Causation-Id", causationId);
  injectTraceContext(hdrs);

  const { span } = startNatsProducerSpan(
    "workflow-service",
    subject,
    hdrs,
  );
  try {
    conn.publish(subject, encoder.encode(JSON.stringify(envelope)), {
      headers: hdrs,
    });
    await conn.flush();
  } finally {
    span.end();
  }
}
