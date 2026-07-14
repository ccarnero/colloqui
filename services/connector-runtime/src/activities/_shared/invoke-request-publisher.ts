// Concrete JetStream-backed implementation of the `publishInvokeRequest`
// port (`manual-loops/connector-invoke-api.md` T04) — the ONLY place in the
// async invoke path where a `nats` import is allowed, mirroring
// `event-publisher.ts`'s role for the sync audit event.
//
// Human-approved subject naming (2026-07-13): same 8-token family as
// `endpoint_call_completed` (producer connector-runtime, domain platform,
// channel endpoint, provider system):
//   evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_requested.v1
//   evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_completed.v1
// (the `invoke_completed` result side is published by the T05 consumer —
// out of scope here; only the subject-name constant lives in this file so
// the provisioning script and T05 share one source of truth.)
//
// FAIL-LOUD CONTRACT (T04, distinct from `service-bus.activity.ts`): this
// module NEVER falls back to core-NATS when the invoke subject is not bound
// to a JetStream stream. A silent fallback would break the `Nats-Msg-Id`
// dedup contract the async invoke's "double POST, one message" guarantee
// depends on — better to fail the request/startup loudly than to accept an
// invocation that silently loses at-least-once + dedup semantics.

import {
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
} from "@yoizen/observability";
import {
  buildEventEnvelope,
  buildSubject,
  TENANT_HEADER,
} from "@yoizen/shared";
import {
  connect,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  headers as natsHeaders,
} from "nats";
import { workflowHttpWorkerConfig } from "../../config";
import type {
  PublishInvokeRequest,
  PublishInvokeRequestArgs,
} from "../../lib/http-facade/publish-invoke-request";
import { err, ok } from "../../lib/result";

const logger = new PinoLoggerService("connector-runtime-invoke-publisher");
const encoder = new TextEncoder();

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;
let jsm: JetStreamManager | null = null;

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) {
    return nc;
  }
  nc = await connect({
    servers: workflowHttpWorkerConfig.natsUrl,
    name: "connector-runtime-invoke",
    waitOnFirstConnect: true,
  });
  js = null;
  jsm = null;
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

async function getJetStreamManager(): Promise<JetStreamManager> {
  if (jsm) {
    return jsm;
  }
  const conn = await getConnection();
  jsm = await conn.jetstreamManager();
  return jsm;
}

export const INVOKE_REQUESTED_KIND = "invoke_requested";
export const INVOKE_COMPLETED_KIND = "invoke_completed";

/** Builds the `invoke_requested` subject for one tenant (§ TAXONOMY.md rule 21). */
export function buildInvokeRequestedSubject(tenantId: string): string {
  return buildSubject({
    tenant: tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    kind: INVOKE_REQUESTED_KIND,
    version: "v1",
  });
}

/** Builds the `invoke_completed` subject for one tenant (T05, defined here for the provisioning script). */
export function buildInvokeCompletedSubject(tenantId: string): string {
  return buildSubject({
    tenant: tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    kind: INVOKE_COMPLETED_KIND,
    version: "v1",
  });
}

/**
 * Sentinel tenant used ONLY to probe stream-binding at startup — never a
 * real tenant id, never published to.
 */
const STARTUP_CHECK_SENTINEL_TENANT = "__startup-check__";

/**
 * Fail-loud startup guard (T04): verifies the `invoke_requested` subject
 * family is bound to a JetStream stream BEFORE the HTTP facade starts
 * accepting traffic. Throws (crashing process startup) when unbound, so a
 * misconfigured deploy never silently serves async invokes with no dedup
 * guarantee. Call once from `http-main.ts` before `Bun.serve()`.
 *
 * Provisioning: `scripts/provision-invoke-stream.ts --apply` (idempotent,
 * additive — never repurposes an existing stream).
 */
export async function assertInvokeSubjectStreamBound(): Promise<void> {
  const manager = await getJetStreamManager();
  const subject = buildInvokeRequestedSubject(STARTUP_CHECK_SENTINEL_TENANT);
  try {
    const streamName = await manager.streams.find(subject);
    logger.log(
      `invoke subject stream-bound check OK: subject=${subject} stream=${streamName}`
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logger.error(
      `invoke subject stream-bound check FAILED: subject=${subject} — ${message}. ` +
        "Run 'bun run scripts/provision-invoke-stream.ts --apply' before serving async invokes."
    );
    throw new Error(
      `connector-runtime invoke subject "${subject}" is not bound to a JetStream stream — refusing to start the async invoke facade (manual-loops/connector-invoke-api.md T04 fail-loud contract). Run 'bun run scripts/provision-invoke-stream.ts --apply'.`
    );
  }
}

/**
 * Real `PublishInvokeRequest` port implementation: publishes the
 * `invoke_requested` envelope to JetStream with `Nats-Msg-Id = invocationId`
 * (dedup) plus tenant + correlation headers, following the header contract
 * established by `service-bus.activity.ts`. Resolves `err(...)` — never
 * throws — on any publish failure (including "no stream matches subject");
 * the caller (`handleInvokeRequest`) maps that to a 503 HTTP response. This
 * function itself never attempts a non-streamed (core-NATS) publish for
 * this subject — see the module-level fail-loud contract note.
 */
export const publishInvokeRequestEvent: PublishInvokeRequest = async (
  args: PublishInvokeRequestArgs
) => {
  const subject = buildInvokeRequestedSubject(args.tenantId);

  const baseOptions = {
    type: "connector.endpoint.invoke_requested.v1",
    source: "//connector-runtime/endpoint-invoke",
    resource: `invocation/${args.invocationId}`,
    tenant: args.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    accountid: args.tenantId,
    payload: {
      connectorId: args.connectorId,
      endpointId: args.endpointId,
      args: args.args,
    },
  } as const;

  const envelope = args.causal
    ? buildEventEnvelope({
        ...baseOptions,
        correlationId: args.causal.correlation_id,
        causationId: args.causal.causation_id,
        depth: args.causal.depth + 1,
      })
    : buildEventEnvelope(baseOptions);

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, args.tenantId);
  hdrs.set("Nats-Msg-Id", args.invocationId);
  hdrs.set("X-Correlation-Id", envelope.correlation_id);
  if (envelope.causation_id) {
    hdrs.set("X-Causation-Id", envelope.causation_id);
  }
  injectTraceContext(hdrs);

  try {
    const jsClient = await getJetStream();
    await jsClient.publish(subject, encoder.encode(JSON.stringify(envelope)), {
      headers: hdrs,
      msgID: args.invocationId,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // Fail loud, no core-NATS fallback for this subject (see module header).
    // Structured correlation via the shared helper (observability.md §3.1),
    // same pattern as `event-publisher.ts`'s `logWithEnvelope` call: the
    // envelope is already built above, so it is in scope here too.
    logWithEnvelope(
      logger,
      envelope,
      "connector.endpoint.invoke_requested.publish",
      `invoke_requested publish FAILED subject=${subject}: ${message}`,
      "error"
    );
    return err({
      message: `invoke_requested publish failed for subject=${subject}: ${message}`,
    });
  }

  // Structured correlation via the shared helper (observability.md §3.1):
  // `envelope` is a fully-built EventEnvelope, so this emits canonical
  // correlation_id / causation_id / depth / tenant / event_id fields.
  logWithEnvelope(
    logger,
    envelope,
    "connector.endpoint.invoke_requested.publish",
    `invoke_requested published subject=${subject} connector=${args.connectorId} endpoint=${args.endpointId}`
  );
  return ok({ subject });
};
