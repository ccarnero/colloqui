// Concrete JetStream-backed implementation of the `publishInvokeRequest`
// port (`manual-loops/connector-invoke-api.md` T04) AND the
// `publishInvokeCompleted` port (T05) — the ONLY place in the async invoke
// path where a `nats` import is allowed, mirroring `event-publisher.ts`'s
// role for the sync audit event.
//
// Human-approved subject naming (2026-07-13): same 8-token family as
// `endpoint_call_completed` (producer connector-runtime, domain platform,
// channel endpoint, provider system):
//   evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_requested.v1
//   evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_completed.v1
//
// DESIGN CHANGE (human-approved 2026-07-14, applied in T05): a dedicated
// `CONNECTOR-INVOKE` stream is IMPOSSIBLE — per-tenant `INGRESS-<TENANT>`
// streams already bind `evt.<tenant>.>` and JetStream forbids overlapping
// stream bindings. Both subjects above ALREADY fall inside that wildcard,
// so they ride the existing `INGRESS-<tenant>` stream (created at tenant
// provisioning) instead of a new one — same mechanism every other
// `evt.<tenant>.*` publisher in the platform relies on
// (`service-bus.activity.ts`, `channelSend`, etc.). Nothing in this file
// provisions a stream; `scripts/verify-invoke-stream-binding.ts` is the
// human-run verification tool, and `assertInvokeSubjectStreamBound` below
// is a startup connectivity probe, not a per-subject guarantee (see its
// own doc comment for why a per-tenant guarantee is impossible at boot).
//
// FAIL-LOUD CONTRACT (T04, distinct from `service-bus.activity.ts`): this
// module NEVER falls back to core-NATS when the invoke subject is not bound
// to a JetStream stream. A silent fallback would break the `Nats-Msg-Id`
// dedup contract the async invoke's "double POST, one message" guarantee
// depends on — better to fail the request loudly (503, see
// `publishInvokeRequestEvent`'s catch below) than to accept an invocation
// that silently loses at-least-once + dedup semantics. Per-request
// enforcement is now the PRIMARY guarantee (the design change above makes a
// blanket startup guarantee impossible since the tenant is unknown at boot).

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
import type {
  PublishInvokeCompleted,
  PublishInvokeCompletedArgs,
} from "../../lib/invoke-consumer/publish-invoke-completed";
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

/** Cross-tenant wildcard subject pattern for the invoke_requested family (T05: `MultiTenantConsumerManager.filterSubject`, `verify-invoke-stream-binding.ts`). */
export const INVOKE_REQUESTED_SUBJECT_FILTER = buildInvokeRequestedSubject("*");
/** Cross-tenant wildcard subject pattern for the invoke_completed family. */
export const INVOKE_COMPLETED_SUBJECT_FILTER = buildInvokeCompletedSubject("*");

/** Matches the per-tenant ingress streams the invoke subjects now ride (`INGRESS-<TENANT>`). */
export const INGRESS_STREAM_PATTERN = /^INGRESS-/;

/**
 * Startup connectivity probe (T04 originally fail-loud-per-subject; T05
 * DESIGN CHANGE per the module header: invoke subjects now ride the
 * per-tenant `INGRESS-<tenant>` streams created at tenant provisioning, not
 * a dedicated stream this process can name upfront). Since the facade/
 * consumer don't know which tenant will invoke first, there is no single
 * subject to probe at boot the way T04 could probe `CONNECTOR-INVOKE`.
 *
 * What this DOES verify (fatal, crashes startup): JetStream itself is
 * reachable — `streams.list()` succeeds. A broker/network failure here
 * means NOTHING would work, so it stays fail-loud.
 *
 * What this does NOT verify (non-fatal, warns only): that any specific
 * tenant's `INGRESS-<tenant>` stream already exists — a fresh cluster with
 * zero tenants provisioned legitimately has none yet. The REAL per-tenant
 * guarantee is enforced per-request by `publishInvokeRequestEvent`'s catch
 * block below (never falls back to core-NATS, returns `err(...)` -> 503)
 * and, for operators who want to verify a specific tenant proactively,
 * `scripts/verify-invoke-stream-binding.ts <tenant...>`.
 */
export async function assertInvokeSubjectStreamBound(): Promise<void> {
  const manager = await getJetStreamManager();
  let matchedStream: string | null = null;
  try {
    const lister = manager.streams.list();
    for await (const info of lister) {
      if (INGRESS_STREAM_PATTERN.test(info.config.name)) {
        matchedStream = info.config.name;
        break;
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logger.error(`JetStream connectivity check FAILED: ${message}`);
    throw new Error(
      `connector-runtime cannot reach JetStream (streams.list() failed: ${message}) — refusing to start the async invoke facade/consumer.`
    );
  }

  if (matchedStream) {
    logger.log(
      `JetStream connectivity OK — invoke subjects ride existing per-tenant streams (e.g. '${matchedStream}'); no dedicated CONNECTOR-INVOKE stream (design change 2026-07-14).`
    );
    return;
  }

  logger.warn(
    "JetStream connectivity OK but no INGRESS-<tenant> stream found yet — fine for a fresh cluster with zero provisioned tenants. Each async invoke still fails loud per-tenant (503) if its own INGRESS-<tenant> stream is missing; see scripts/verify-invoke-stream-binding.ts to check a specific tenant."
  );
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
      // T05: carried verbatim so the consumer can deliver the result to it
      // after parking — see `parse-invoke-requested-envelope.ts`.
      ...(args.webhook !== undefined && { webhook: args.webhook }),
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

/**
 * Real `PublishInvokeCompleted` port implementation (T05): publishes the
 * `invoke_completed` transport event, threading the causal context of the
 * ORIGINAL `invoke_requested` envelope (`args.causal`, derived by
 * `parseInvokeRequestedEnvelope`) so the two events join the same
 * correlation chain. BEST-EFFORT per the port's own contract
 * (`publish-invoke-completed.ts`'s doc comment) — `handleInvokeRequestedMessage`
 * treats a rejected/err result as a warning, never a nak, because the
 * result is already durably parked in Redis by the time this runs.
 */
export const publishInvokeCompletedEvent: PublishInvokeCompleted = async (
  args: PublishInvokeCompletedArgs
) => {
  const subject = buildInvokeCompletedSubject(args.tenantId);

  const envelope = buildEventEnvelope({
    type: "connector.endpoint.invoke_completed.v1",
    source: "//connector-runtime/endpoint-invoke",
    resource: `invocation/${args.invocationId}`,
    tenant: args.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    accountid: args.tenantId,
    correlationId: args.causal.correlation_id,
    causationId: args.causal.causation_id,
    depth: args.causal.depth + 1,
    payload: {
      connectorId: args.connectorId,
      endpointId: args.endpointId,
      outcome: args.record.outcome,
      ...(args.record.result !== undefined && { result: args.record.result }),
      ...(args.record.error !== undefined && { error: args.record.error }),
    },
  });

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, args.tenantId);
  hdrs.set("Nats-Msg-Id", `completed:${args.invocationId}`);
  hdrs.set("X-Correlation-Id", envelope.correlation_id);
  if (envelope.causation_id) {
    hdrs.set("X-Causation-Id", envelope.causation_id);
  }
  injectTraceContext(hdrs);

  try {
    const jsClient = await getJetStream();
    await jsClient.publish(subject, encoder.encode(JSON.stringify(envelope)), {
      headers: hdrs,
      msgID: `completed:${args.invocationId}`,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logWithEnvelope(
      logger,
      envelope,
      "connector.endpoint.invoke_completed.publish",
      `invoke_completed publish FAILED subject=${subject}: ${message}`,
      "warn"
    );
    return err({
      message: `invoke_completed publish failed for subject=${subject}: ${message}`,
    });
  }

  logWithEnvelope(
    logger,
    envelope,
    "connector.endpoint.invoke_completed.publish",
    `invoke_completed published subject=${subject} connector=${args.connectorId} endpoint=${args.endpointId} outcome=${args.record.outcome}`
  );
  return ok({ subject });
};
