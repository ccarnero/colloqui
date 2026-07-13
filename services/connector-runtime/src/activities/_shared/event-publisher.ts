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
import type { EndpointCacheResult } from "./http-call-with-retry";

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

export interface IEndpointCallEvent {
  readonly tenantId: string;
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: EndpointCacheResult;
  readonly requestHeaders?: Record<string, string>;
  readonly requestBody?: string;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: string;
  readonly cacheKey?: string;
  readonly cacheTtlSeconds?: number;
  /**
   * Causal context from the workflow's `endpointCall`/`serviceCall` action,
   * mirroring `mcp-call.activity.ts`'s `causal` threading (metering-foundation.md
   * G5). When present, the published envelope's `correlation_id`/`causation_id`/
   * `transport.depth` join the run's causal chain instead of becoming a root
   * event. Absent `causal` preserves today's behavior (random correlation,
   * null causation, depth 0).
   */
  readonly causal?: EventCausalContext;
}

/**
 * Fire-and-forget: publishes an endpoint_call_completed event to NATS JetStream.
 * Failures are logged as warnings and never propagate to the caller — this is
 * an observability side-effect, not a critical path.
 */
export function publishEndpointCallEvent(evt: IEndpointCallEvent): void {
  void emit(evt).catch((err) =>
    logger.warn(
      `endpoint_call event publish failed: ${err instanceof Error ? err.message : String(err)}`
    )
  );
}

async function emit(evt: IEndpointCallEvent): Promise<void> {
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

  const baseOptions = {
    type: "connector.endpoint_call.completed.v1",
    source: "//connector-runtime/endpoint-call",
    resource: `adapter/${evt.adapterId}`,
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
