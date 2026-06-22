import { PinoLoggerService } from "@yoizen/observability";
import {
  buildEventEnvelope,
  buildSubject,
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

  const envelope = buildEventEnvelope({
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
  });

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, evt.tenantId);

  const jsClient = await getJetStream();
  await jsClient.publish(subject, encoder.encode(JSON.stringify(envelope)), {
    headers: hdrs,
  });

  logger.log(
    `published endpoint_call event tenant=${evt.tenantId} adapter=${evt.adapterId} status=${evt.status}`
  );
}
