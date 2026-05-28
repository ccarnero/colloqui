import {
  connect,
  headers as natsHeaders,
  type JetStreamClient,
  type NatsConnection,
} from "nats";
import type { EventCausalContext, ServiceBusCallArgs } from "@yoizen/shared";
import {
  TENANT_HEADER,
  computeIdempotencyKey,
  generateId,
} from "@yoizen/shared";
import { injectTraceContext, PinoLoggerService } from "@yoizen/observability";
import { workflowServiceConfig } from "../../config";

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;
const encoder = new TextEncoder();
const logger = new PinoLoggerService("service-bus.activity");

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) return nc;
  const url = workflowServiceConfig.natsUrl;
  nc = await connect({ servers: url, name: "workflow-service" });
  js = null;
  return nc;
}

async function getJetStream(): Promise<JetStreamClient> {
  if (js) return js;
  const conn = await getConnection();
  js = conn.jetstream();
  return js;
}

/**
 * Detects the JetStream "subject has no bound stream" error so the
 * activity can transparently fall back to a core-NATS publish when
 * a workflow targets a non-streamed subject (e.g. ad-hoc fan-out).
 * Matching by message text rather than error code keeps the check
 * resilient across nats.js minor versions.
 */
function isNoStreamForSubject(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("no stream matches") ||
    msg.includes("no responders available")
  );
}

/**
 * Derives the JetStream dedup key. Prefers the caller-provided
 * `args.dedupKey` (escape hatch for workflows that need full control),
 * otherwise hashes `{subject, payload, headers}` so two retries of the
 * same Temporal activity invocation collapse server-side inside the
 * stream's `duplicate_window` (default 2 min). Pre-2026-05-22 this
 * activity published with no `Nats-Msg-Id` at all, so every Temporal
 * retry was a brand-new stream message — see
 * `post-mortem/POST-MORTEM.md` §P1.3 fix 1.
 */
function deriveDedupKey(args: ServiceBusCallArgs): string {
  if (args.dedupKey && args.dedupKey.length > 0) return args.dedupKey;
  return computeIdempotencyKey({
    subject: args.subject,
    payload: args.payload ?? null,
    headers: args.headers ?? null,
  });
}

export async function executeServiceBusCall(
  args: ServiceBusCallArgs,
  tenantId: string,
  causal?: EventCausalContext,
  executionId?: string,
): Promise<{ published: true; subject: string }> {
  if (executionId) {
    logger.log(`serviceBusCall executionId=${executionId} tenant=${tenantId}`);
  }

  const conn = await getConnection();

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, tenantId);

  const correlationId = causal?.correlation_id ?? generateId();
  const causationId = causal?.causation_id ?? null;
  hdrs.set("X-Correlation-Id", correlationId);
  if (causationId) hdrs.set("X-Causation-Id", causationId);

  if (args.headers) {
    const entries = Object.entries(args.headers);
    for (let i = 0; i < entries.length; i++) {
      hdrs.set(entries[i][0], entries[i][1]);
    }
  }

  const dedupKey = deriveDedupKey(args);
  hdrs.set("Nats-Msg-Id", dedupKey);

  injectTraceContext(hdrs);

  const payload = args.payload
    ? encoder.encode(JSON.stringify(args.payload))
    : new Uint8Array(0);

  /**
   * Prefer JetStream publish so the broker actually honours the
   * `Nats-Msg-Id` dedup contract; fall back to core-NATS only when
   * the subject is not bound to any stream. Core NATS has no
   * server-side dedup, so a fall-back path means the activity is
   * still vulnerable to Temporal-retry duplication for those
   * subjects — workflows that need strict dedup MUST target a
   * streamed subject.
   */
  try {
    const stream = await getJetStream();
    await stream.publish(args.subject, payload, {
      headers: hdrs,
      msgID: dedupKey,
    });
  } catch (err) {
    if (!isNoStreamForSubject(err)) throw err;
    conn.publish(args.subject, payload, { headers: hdrs });
    await conn.flush();
  }

  return { published: true, subject: args.subject };
}
