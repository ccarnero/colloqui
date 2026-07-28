import { logWithEnvelope, PinoLoggerService } from "@yoizen/observability";
import {
  buildEventEnvelope,
  buildSubject,
  DepthExceededError,
  type EventCausalContext,
  TENANT_HEADER,
} from "@yoizen/shared";
import {
  connect,
  type JetStreamClient,
  type NatsConnection,
  headers as natsHeaders,
} from "nats";
import { workflowHttpWorkerConfig } from "../../config";
import type {
  EndpointCallEventSink,
  IEndpointCallEventPayload,
} from "../../lib/endpoint-call-core";

const logger = new PinoLoggerService("connector-runtime-events");
const encoder = new TextEncoder();
const MAX_URL_LEN = 2048;

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) {
    return nc;
  }
  nc = await connect({
    servers: workflowHttpWorkerConfig.natsUrl,
    name: "connector-runtime",
    waitOnFirstConnect: true,
  });
  js = null;
  return nc;
}

async function getJetStream(): Promise<JetStreamClient> {
  if (js) {
    return js;
  }
  const conn = await getConnection();
  js = conn.jetstream();
  return js;
}

/**
 * Backward-compatible alias for the core's audit-event payload shape
 * (`src/lib/endpoint-call-core/types.ts`'s `IEndpointCallEventPayload`).
 * The core owns the canonical type since it defines the `EndpointCallEventSink`
 * port that this module implements; kept re-exported under its historical
 * name so nothing outside this module has to change.
 */
export type IEndpointCallEvent = IEndpointCallEventPayload;

/**
 * Fire-and-forget: publishes an endpoint_call_completed event to NATS JetStream.
 * Failures are logged as warnings and never propagate to the caller — this is
 * an observability side-effect, not a critical path.
 *
 * This is the concrete `EndpointCallEventSink` implementation injected into
 * the pure `endpoint-call-core` lib by entrypoints (today: the Temporal
 * activity wrapper, `endpoint-call.activity.ts`) — the ONLY place in the
 * endpoint-call pipeline where a `nats` import is allowed
 * (`manual-loops/connector-invoke-api.md` T01).
 */
export const publishEndpointCallEvent: EndpointCallEventSink = (evt) => {
  void emit(evt).catch((err) =>
    logger.warn(
      `endpoint_call event publish failed: ${err instanceof Error ? err.message : String(err)}`
    )
  );
};

async function emit(evt: IEndpointCallEventPayload): Promise<void> {
  const payload: Record<string, unknown> = {
    adapterId: evt.adapterId,
    endpointId: evt.endpointId,
    method: evt.method,
    resolvedUrl:
      evt.resolvedUrl.length > MAX_URL_LEN
        ? `${evt.resolvedUrl.slice(0, MAX_URL_LEN)}…`
        : evt.resolvedUrl,
    status: evt.status,
    durationMs: evt.durationMs,
    cacheResult: evt.cacheResult,
    ...(evt.requestHeaders !== undefined && {
      requestHeaders: evt.requestHeaders,
    }),
    ...(evt.requestBody !== undefined && { requestBody: evt.requestBody }),
    ...(evt.responseHeaders !== undefined && {
      responseHeaders: evt.responseHeaders,
    }),
    ...(evt.responseBody !== undefined && { responseBody: evt.responseBody }),
    ...(evt.cacheKey !== undefined && { cacheKey: evt.cacheKey }),
    ...(evt.cacheTtlSeconds !== undefined && {
      cacheTtlSeconds: evt.cacheTtlSeconds,
    }),
    ...(evt.invocationId !== undefined && { invocationId: evt.invocationId }),
  };

  const subject = buildSubject({
    tenant: evt.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    kind: "endpoint_call_completed",
    version: "v1",
  });

  // Explicit `resource` override (connection-call-inspector.md T01/T02) wins
  // over the invocation/adapter derivation below — non-adapter callers
  // (serviceCall's `service/<name>`, the raw branch's `raw/<host>`) don't fit
  // either shape. Standalone (non-workflow) callers set `invocationId` (HTTP
  // facade, T02 of connector-invoke-api.md) so the audit event is addressable
  // by invocation even though it starts a root correlation (no `causal` to
  // join). Workflow calls (Temporal activity) set neither and keep the
  // pre-T02 `adapter/${adapterId}` resource shape.
  const resource =
    evt.resource ??
    (evt.invocationId
      ? `invocation/${evt.invocationId}`
      : `adapter/${evt.adapterId}`);

  const baseOptions = {
    type: "connector.endpoint_call.completed.v1",
    source: "//connector-runtime/endpoint-call",
    resource,
    tenant: evt.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    accountid: evt.tenantId,
    payload,
  } as const;

  let envelope;
  try {
    // Causal threading: join the run's correlation chain when the calling
    // workflow action carried one, same pattern as `mcp-call.activity.ts`'s
    // `causal` → `reportMcpUsageEvent` threading (metering-foundation.md G5).
    envelope = buildEventEnvelope(
      evt.causal
        ? {
            ...baseOptions,
            correlationId: evt.causal.correlation_id,
            causationId: evt.causal.causation_id,
            depth: evt.causal.depth + 1,
          }
        : baseOptions
    );
  } catch (err) {
    if (err instanceof DepthExceededError) {
      // Never let causal threading break the fire-and-forget publish path:
      // fall back to a root event (no correlation/causation inherited) and
      // warn so the depth cap breach is visible in logs.
      logger.warn(
        `endpoint_call event depth exceeded for tenant=${evt.tenantId} adapter=${evt.adapterId}, publishing as root event: ${err.message}`
      );
      envelope = buildEventEnvelope(baseOptions);
    } else {
      throw err;
    }
  }

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, evt.tenantId);

  const jsClient = await getJetStream();
  await jsClient.publish(subject, encoder.encode(JSON.stringify(envelope)), {
    headers: hdrs,
  });

  // Structured correlation via the shared helper (observability.md §3.1):
  // `envelope` is a fully-built EventEnvelope, so this emits canonical
  // correlation_id / causation_id / depth / tenant / event_id fields.
  logWithEnvelope(
    logger,
    envelope,
    "connector.endpoint_call.publish",
    `published endpoint_call event adapter=${evt.adapterId} status=${evt.status}`
  );
}

/**
 * Payload shape for `connector.mcp_call.completed.v1`
 * (`manual-loops/connectors/connection-call-inspector.md` T03). This is
 * ADDITIVE to `reportMcpUsageEvent` (`@yoizen/shared`'s HTTP call to
 * agent-admin-service, unchanged) — the bus event carries the tool call's
 * `arguments`/`result` content that the aggregate usage summary never did.
 */
export interface IMcpCallEventPayload {
  tenantId: string;
  mcpServerId: string;
  serverName: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  error?: string;
  /** Tool call arguments, already through `truncate-body.ts` (8KB). */
  arguments?: string;
  /** Tool result content, already through `truncate-body.ts` (8KB). */
  result?: string;
  causal?: EventCausalContext;
}

/**
 * Fire-and-forget: publishes an `mcp_call_completed` event to NATS
 * JetStream. Failures are logged as warnings and never propagate to the
 * caller — same fire-and-forget contract as `publishEndpointCallEvent`.
 *
 * Resource is `mcp/<mcpServerId>` (decision 7 of
 * connection-call-inspector.md). Reuses this module's `buildEventEnvelope`/
 * `buildSubject`/`DepthExceededError`/JetStream plumbing instead of a new
 * publisher module, per T03.
 */
export const publishMcpCallEvent = (evt: IMcpCallEventPayload): void => {
  void emitMcpCall(evt).catch((err) =>
    logger.warn(
      `mcp_call event publish failed: ${err instanceof Error ? err.message : String(err)}`
    )
  );
};

async function emitMcpCall(evt: IMcpCallEventPayload): Promise<void> {
  const payload: Record<string, unknown> = {
    serverName: evt.serverName,
    mcpServerId: evt.mcpServerId,
    toolName: evt.toolName,
    success: evt.success,
    durationMs: evt.durationMs,
    ...(evt.error !== undefined && { error: evt.error }),
    ...(evt.arguments !== undefined && { arguments: evt.arguments }),
    ...(evt.result !== undefined && { result: evt.result }),
  };

  const subject = buildSubject({
    tenant: evt.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "mcp",
    provider: "system",
    kind: "mcp_call_completed",
    version: "v1",
  });

  const baseOptions = {
    type: "connector.mcp_call.completed.v1",
    source: "//connector-runtime/mcp-call",
    resource: `mcp/${evt.mcpServerId}`,
    tenant: evt.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "mcp",
    provider: "system",
    accountid: evt.tenantId,
    payload,
  } as const;

  let envelope;
  try {
    // Causal threading: join the run's correlation chain when the calling
    // activity carried one (`mcp-call.activity.ts`'s `outcome.causal`,
    // same pattern as `emit` above).
    envelope = buildEventEnvelope(
      evt.causal
        ? {
            ...baseOptions,
            correlationId: evt.causal.correlation_id,
            causationId: evt.causal.causation_id,
            depth: evt.causal.depth + 1,
          }
        : baseOptions
    );
  } catch (err) {
    if (err instanceof DepthExceededError) {
      // Never let causal threading break the fire-and-forget publish path:
      // fall back to a root event (no correlation/causation inherited) and
      // warn so the depth cap breach is visible in logs.
      logger.warn(
        `mcp_call event depth exceeded for tenant=${evt.tenantId} server=${evt.mcpServerId}, publishing as root event: ${err.message}`
      );
      envelope = buildEventEnvelope(baseOptions);
    } else {
      throw err;
    }
  }

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, evt.tenantId);

  const jsClient = await getJetStream();
  await jsClient.publish(subject, encoder.encode(JSON.stringify(envelope)), {
    headers: hdrs,
  });

  logWithEnvelope(
    logger,
    envelope,
    "connector.mcp_call.publish",
    `published mcp_call event server=${evt.mcpServerId} tool=${evt.toolName} success=${evt.success}`
  );
}
