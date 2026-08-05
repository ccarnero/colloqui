import { injectTraceContext, PinoLoggerService } from "@yoizen/observability";
import type { EventCausalContext, ServiceBusCallArgs } from "@yoizen/shared";
import {
  computeIdempotencyKey,
  generateId,
  TENANT_HEADER,
} from "@yoizen/shared";
import {
  connect,
  type JetStreamClient,
  type NatsConnection,
  headers as natsHeaders,
} from "nats";
import { workflowServiceConfig } from "../../config";

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;
const encoder = new TextEncoder();
const logger = new PinoLoggerService("service-bus.activity");

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) {
    return nc;
  }
  const url = workflowServiceConfig.natsUrl;
  nc = await connect({ servers: url, name: "workflow-service" });
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
 * Decides whether a failed JetStream publish means "no stream is bound to
 * this subject" — the one case where falling back to a core-NATS publish is
 * correct (the documented ad-hoc fan-out path).
 *
 * This CANNOT be decided from the publish error alone. `js.publish()` fails
 * with a bare `503` when nothing answers, and in nats.js `503` is both
 * `NoResponders` (no stream bound — fall back) and `JetStreamNotEnabled`
 * (JetStream itself is down — falling back would silently drop the dedup
 * guarantee and mask an outage). `ErrorCode` maps both to the same "503"
 * string, so they are indistinguishable at the publish site.
 *
 * So we ASK JetStream. `streams.find(subject)` queries `$JS.API.STREAM.NAMES`:
 *   - it throws "no stream matches subject" -> JetStream answered, and there
 *     genuinely is no stream for this subject -> fall back;
 *   - it fails any other way (503/timeout, i.e. the API itself has no
 *     responder) -> JetStream is unreachable -> do NOT fall back, let the
 *     original publish error propagate so the outage stays visible.
 * The probe costs one request and runs ONLY on the error path.
 *
 * Historical note: this function used to match the publish error's message
 * text for "no stream matches" / "no responders available". The first of
 * those is exactly what `findStream()` throws — the check was calibrated for
 * this probe's error but applied to the publish's, which carries neither
 * phrase. The fallback therefore never fired and every ad-hoc publish failed.
 */
async function isNoStreamForSubject(subject: string): Promise<boolean> {
  try {
    const conn = await getConnection();
    await conn.jetstreamManager().then((jsm) => jsm.streams.find(subject));
    // A stream DOES match: the publish failure was something else entirely,
    // so a core-NATS fallback would paper over it.
    return false;
  } catch (probeErr) {
    return (
      probeErr instanceof Error &&
      probeErr.message.toLowerCase().includes("no stream matches")
    );
  }
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
  if (args.dedupKey && args.dedupKey.length > 0) {
    return args.dedupKey;
  }
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
  executionId?: string
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
  if (causationId) {
    hdrs.set("X-Causation-Id", causationId);
  }

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
    if (!(await isNoStreamForSubject(args.subject))) {
      throw err;
    }
    logger.log(
      `serviceBusCall falling back to core NATS: no stream bound to '${args.subject}' (no server-side dedup on this path)`
    );
    conn.publish(args.subject, payload, { headers: hdrs });
    await conn.flush();
  }

  return { published: true, subject: args.subject };
}
