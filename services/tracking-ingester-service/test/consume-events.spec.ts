import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsMsg } from "nats";
import {
  buildConsumerSpecs,
  consumeEvents,
  DLQ_STREAM_PATTERN,
  GATEWAY_AUDIT_STREAM_PATTERN,
  INGRESS_STREAM_PATTERN,
  makeTrackedEventHandler,
  TRK_DLQ_DURABLE,
  TRK_GATEWAY_AUDIT_DURABLE,
  TRK_INGRESS_DURABLE,
  type TrackedConsumerSpec,
} from "../src/lib/consume-events.js";
import type {
  InsertError,
  InsertOk,
} from "../src/lib/insert-tracked-events.js";
import type { ProcessOutcome } from "../src/lib/process-tracked-message.js";
import { err, ok, type Result } from "../src/lib/result.js";
import type { TrackedEventRow } from "../src/lib/to-tracked-event-row.js";
import { createTrackedEventBuffer } from "../src/lib/tracked-event-buffer.js";
import type {
  ITrackingIngesterMetricsSink,
  UnknownReason,
} from "../src/lib/tracking-ingester-metrics.js";

const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "bus-events"
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

// ---- test doubles ---------------------------------------------------------

interface FakeMsg {
  msg: JsMsg;
  calls: { ack: number; nak: number; term: number };
}

function makeMsg(opts: {
  subject: string;
  stream: string;
  seq: number;
  payload: unknown;
  raw?: string;
}): FakeMsg {
  const calls = { ack: 0, nak: 0, term: 0 };
  const bytes =
    opts.raw !== undefined
      ? new TextEncoder().encode(opts.raw)
      : new TextEncoder().encode(JSON.stringify(opts.payload));
  const msg = {
    subject: opts.subject,
    data: bytes,
    info: { stream: opts.stream, streamSequence: opts.seq },
    ack() {
      calls.ack += 1;
    },
    nak() {
      calls.nak += 1;
    },
    term() {
      calls.term += 1;
    },
  } as unknown as JsMsg;
  return { msg, calls };
}

function makeMetrics(): {
  sink: ITrackingIngesterMetricsSink;
  processed: ProcessOutcome[];
  unknown: UnknownReason[];
  skipped: { family: string; tenant: string | null }[];
  insertFailures: number;
} {
  const processed: ProcessOutcome[] = [];
  const unknown: UnknownReason[] = [];
  const skipped: { family: string; tenant: string | null }[] = [];
  let insertFailures = 0;
  const sink: ITrackingIngesterMetricsSink = {
    recordProcessed(outcome) {
      processed.push(outcome);
    },
    recordUnknown(reason) {
      unknown.push(reason);
    },
    recordSkipped(family, tenant) {
      skipped.push({ family, tenant });
    },
    recordInsertFailure() {
      insertFailures += 1;
    },
  };
  return {
    sink,
    processed,
    unknown,
    skipped,
    get insertFailures() {
      return insertFailures;
    },
  };
}

// A batchSize-1 buffer flushes on every enqueue, so ack/nak resolve
// deterministically within the awaited handler.
function bufferWith(
  insert: (
    rows: readonly TrackedEventRow[]
  ) => Promise<Result<InsertOk, InsertError>>
) {
  const inserted: TrackedEventRow[] = [];
  const wrapped = async (
    rows: readonly TrackedEventRow[]
  ): Promise<Result<InsertOk, InsertError>> => {
    const result = await insert(rows);
    if (result.ok) {
      inserted.push(...rows);
    }
    return result;
  };
  return {
    buffer: createTrackedEventBuffer({ insert: wrapped, batchSize: 1 }),
    inserted,
  };
}

const okInsert = async (
  rows: readonly TrackedEventRow[]
): Promise<Result<InsertOk, InsertError>> => ok({ inserted: rows.length });

const failInsert = async (): Promise<Result<InsertOk, InsertError>> =>
  err({ reason: "connection reset" });

// ---- handler tests --------------------------------------------------------

describe("makeTrackedEventHandler — per-message pipeline", () => {
  it("acks after a committed insert of a canonical envelope", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    const { msg, calls } = makeMsg({
      subject:
        "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1",
      stream: "INGRESS-TENANT-A",
      seq: 7,
      payload: loadFixture("audit-service-channel-envelope-01.json"),
    });

    await handler(msg);

    expect(calls.ack).toBe(1);
    expect(calls.nak).toBe(0);
    expect(calls.term).toBe(0);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.event_id).toBe("env-ch-1");
    expect(metrics.processed).toEqual(["canonical"]);
    expect(metrics.unknown).toEqual([]);
  });

  it("naks (no ack) on a transient insert failure", async () => {
    const { buffer } = bufferWith(failInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    const { msg, calls } = makeMsg({
      subject:
        "evt.t1.api-gateway.messaging.whatsapp.webhook.webhook_received.v1",
      stream: "INGRESS-T1",
      seq: 8,
      payload: loadFixture("channel-service-webhook-ingress-envelope-01.json"),
    });

    await handler(msg);

    expect(calls.nak).toBe(1);
    expect(calls.ack).toBe(0);
    expect(calls.term).toBe(0);
    expect(metrics.insertFailures).toBe(1);
  });

  it("alarms only on an UNKNOWN_RULES classification (16/17/18) and still persists + acks", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    // Compliant envelope, but an 8-token subject with a non-whitelisted channel
    // token classifies to rule 17 (unknown business_fn) — in UNKNOWN_RULES, so
    // it is the alarm (TAXONOMY.md §3/§4).
    const { msg, calls } = makeMsg({
      subject:
        "evt.tenant-a.mystery-producer.mystery.weirdchan.prov.mysterykind.v1",
      stream: "INGRESS-TENANT-A",
      seq: 9,
      payload: loadFixture("audit-service-channel-envelope-01.json"),
    });

    await handler(msg);

    expect(metrics.processed).toEqual(["unknown"]);
    expect(metrics.unknown).toEqual(["classification"]);
    expect(calls.ack).toBe(1);
    expect(inserted).toHaveLength(1);
    expect([16, 17, 18]).toContain(inserted[0]!.rule);
  });

  it("does NOT alarm on a rule-19 workflow-service envelope (recognized canonical, not in UNKNOWN_RULES)", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    // rule > 15 but NOT in UNKNOWN_RULES (16/17/18): a `rule >= 16` test would
    // wrongly alarm here. Subject drives classification to rule 19.
    const { msg, calls } = makeMsg({
      subject:
        "evt.acme.workflow-service.workflow.internal.native.execution_completed.v1",
      stream: "INGRESS-ACME",
      seq: 12,
      payload: loadFixture("audit-service-channel-envelope-01.json"),
    });

    await handler(msg);

    expect(metrics.processed).toEqual(["canonical"]);
    expect(metrics.unknown).toEqual([]); // NOT an alarm
    expect(calls.ack).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.rule).toBe(19);
  });

  it("tracks a non_envelope_family with a synthesized <stream>:<seq> event_id (no alarm)", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    const { msg, calls } = makeMsg({
      subject: "audit.gateway.request",
      stream: "GATEWAY_AUDIT",
      seq: 41771,
      payload: loadFixture("api-gateway-gateway-audit-event-01.json"),
    });

    await handler(msg);

    expect(metrics.processed).toEqual(["non_envelope"]);
    expect(metrics.unknown).toEqual([]); // NOT an alarm
    expect(calls.ack).toBe(1);
    expect(calls.term).toBe(0);
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.event_id).toBe("GATEWAY_AUDIT:41771");
    expect(row.tech).toBe("gateway-audit");
    expect(row.business_fn).toBe("audit");
    expect(row.rule).toBe(14);
    expect(row.tenant).toBeNull();
  });

  it("skips a rule-20 runtime-presence heartbeat: counts skipped, no insert, acks, no unknown alarm", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    const { msg, calls } = makeMsg({
      subject:
        "evt.acme.ai-agent-gateway.automation.platform.internal.online.v1",
      stream: "INGRESS-ACME",
      seq: 1249,
      // Non-canonical heartbeat body — must still be skipped, never persisted.
      payload: { hb: true },
    });

    await handler(msg);

    expect(metrics.processed).toEqual(["skipped"]);
    expect(metrics.skipped).toEqual([
      { family: "runtime-presence", tenant: "acme" },
    ]);
    expect(metrics.unknown).toEqual([]); // NOT an alarm
    expect(calls.ack).toBe(1);
    expect(calls.nak).toBe(0);
    expect(calls.term).toBe(0);
    expect(inserted).toHaveLength(0); // counted, NOT persisted
  });

  it("persists malformed drift as unknown and terms (not naks) after commit", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    // JSON body on a canonical evt.* subject that fails isCompliantEnvelope.
    const { msg, calls } = makeMsg({
      subject:
        "evt.t1.api-gateway.messaging.whatsapp.webhook.webhook_received.v1",
      stream: "INGRESS-T1",
      seq: 10,
      payload: { not: "an envelope" },
    });

    await handler(msg);

    expect(metrics.processed).toEqual(["malformed"]);
    expect(metrics.unknown).toEqual(["malformed"]);
    expect(calls.term).toBe(1);
    expect(calls.ack).toBe(0);
    expect(calls.nak).toBe(0);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.rule).toBe(18);
    expect(inserted[0]!.tech).toBe("unknown");
    expect(inserted[0]!.event_id).toBe("INGRESS-T1:10");
  });

  it("treats an undecodable (non-JSON) body as malformed drift", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    const { msg, calls } = makeMsg({
      subject:
        "evt.t1.api-gateway.messaging.whatsapp.webhook.webhook_received.v1",
      stream: "INGRESS-T1",
      seq: 11,
      payload: null,
      raw: "<<<not json>>>",
    });

    await handler(msg);

    expect(metrics.processed).toEqual(["malformed"]);
    expect(metrics.unknown).toEqual(["malformed"]);
    expect(calls.term).toBe(1);
    expect(inserted[0]!.envelope).toBe("<<<not json>>>");
  });
});

// ---- claim-check resolution at ingest (T02 of payload-capture) ------------

function slimClaimCheckEnvelope(): Record<string, unknown> {
  return {
    specversion: "1.0",
    id: "evt-claim-ingest-1",
    source: "test/claim-check",
    type: "io.yoizen.messaging.whatsapp.meta.received.v1",
    resource: "tenant/tenant-a/x",
    time: "2026-07-11T00:00:00.000Z",
    traceid: "44444444-4444-4444-4444-444444444444",
    causation_id: null,
    correlation_id: "corr-claim-ingest-1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    channel: "whatsapp",
    provider: "meta",
    accountid: "acc-1",
    idempotencykey: "idem-claim-ingest-1",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: {
      received_at: "2026-07-11T00:00:00.000Z",
      payload_inline: false,
      payload_ref:
        "nats://objstore/PAYLOAD-tenant-a/evt-claim-ingest-1-payload",
      payload_bytes: 400_000,
      payload_checksum: "sha256:deadbeef",
      payload: null,
    },
    kind: "received",
  };
}

describe("makeTrackedEventHandler — claim-check resolution at ingest (T02)", () => {
  const CLAIM_CHECK_SUBJECT =
    "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1";

  it("resolves successfully: persists the envelope WITH payload, payload_status='resolved'", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({
      buffer,
      metrics: metrics.sink,
      claimCheck: {
        resolve: async (envelope) => ({
          ...envelope,
          data: {
            ...envelope.data,
            payload_inline: true,
            payload_ref: null,
            payload: { conversationId: "conv-resolved" },
          },
        }),
      },
    });

    const { msg, calls } = makeMsg({
      subject: CLAIM_CHECK_SUBJECT,
      stream: "INGRESS-TENANT-A",
      seq: 100,
      payload: slimClaimCheckEnvelope(),
    });

    await handler(msg);

    expect(calls.ack).toBe(1);
    expect(calls.nak).toBe(0);
    expect(calls.term).toBe(0);
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.payload_status).toBe("resolved");
    expect(
      (row.envelope as { data: { payload: unknown } }).data.payload
    ).toEqual({ conversationId: "conv-resolved" });
  });

  it("resolution failure (expired/blob missing): persists the SLIM envelope, payload_status='unresolved', acks — never naks/terms", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({
      buffer,
      metrics: metrics.sink,
      claimCheck: {
        resolve: async () => {
          throw new Error("blob_not_found: expired ref");
        },
      },
    });

    const { msg, calls } = makeMsg({
      subject: CLAIM_CHECK_SUBJECT,
      stream: "INGRESS-TENANT-A",
      seq: 101,
      payload: slimClaimCheckEnvelope(),
    });

    await handler(msg);

    // NEVER nak/term for a resolution failure — ack after persisting slim.
    expect(calls.nak).toBe(0);
    expect(calls.term).toBe(0);
    expect(calls.ack).toBe(1);
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.payload_status).toBe("unresolved");
    expect(
      (row.envelope as { data: { payload: unknown } }).data.payload
    ).toBeNull();
  });

  it("resolution timeout: persists slim + 'unresolved', never naks", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({
      buffer,
      metrics: metrics.sink,
      claimCheck: {
        resolve: () => new Promise(() => {}), // never settles
        timeoutMs: 20,
      },
    });

    const { msg, calls } = makeMsg({
      subject: CLAIM_CHECK_SUBJECT,
      stream: "INGRESS-TENANT-A",
      seq: 102,
      payload: slimClaimCheckEnvelope(),
    });

    await handler(msg);

    expect(calls.nak).toBe(0);
    expect(calls.ack).toBe(1);
    expect(inserted[0]!.payload_status).toBe("unresolved");
  }, 2_000);

  it("does not attempt resolution when the message is not a claim check", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    let resolveCalls = 0;
    const handler = makeTrackedEventHandler({
      buffer,
      metrics: metrics.sink,
      claimCheck: {
        resolve: async (envelope) => {
          resolveCalls += 1;
          return envelope;
        },
      },
    });

    const { msg, calls } = makeMsg({
      subject: CLAIM_CHECK_SUBJECT,
      stream: "INGRESS-TENANT-A",
      seq: 103,
      payload: loadFixture("audit-service-channel-envelope-01.json"),
    });

    await handler(msg);

    expect(calls.ack).toBe(1);
    expect(resolveCalls).toBe(0);
    expect(inserted[0]!.is_claim_check).toBe(false);
  });

  it("preserves today's behavior (payload_status='none') when no claimCheck dep is configured", async () => {
    const { buffer, inserted } = bufferWith(okInsert);
    const metrics = makeMetrics();
    const handler = makeTrackedEventHandler({ buffer, metrics: metrics.sink });

    const { msg, calls } = makeMsg({
      subject: CLAIM_CHECK_SUBJECT,
      stream: "INGRESS-TENANT-A",
      seq: 104,
      payload: slimClaimCheckEnvelope(),
    });

    await handler(msg);

    expect(calls.ack).toBe(1);
    expect(inserted[0]!.payload_status).toBe("none");
  });
});

// ---- orchestrator / durable-naming tests ----------------------------------

describe("consumeEvents — durable consumer groups", () => {
  const noop = async (): Promise<void> => {};

  it("builds ingress/gateway-audit/dlq specs with the trk- durable prefix", () => {
    const specs = buildConsumerSpecs(noop);
    const byDurable = new Map(specs.map((s) => [s.durableName, s]));

    expect(specs).toHaveLength(3);
    expect(byDurable.get(TRK_INGRESS_DURABLE)?.streamPattern).toBe(
      INGRESS_STREAM_PATTERN
    );
    expect(byDurable.get(TRK_GATEWAY_AUDIT_DURABLE)?.streamPattern).toBe(
      GATEWAY_AUDIT_STREAM_PATTERN
    );
    expect(byDurable.get(TRK_DLQ_DURABLE)?.streamPattern).toBe(
      DLQ_STREAM_PATTERN
    );
    for (const spec of specs) {
      expect(spec.durableName.startsWith("trk-")).toBe(true);
      expect(spec.dlq.enabled).toBe(false); // DLQ disabled for our own consumers
      expect(spec.maxAckPending).toBe(1_000);
    }
  });

  it("starts one manager per spec and stops them all", async () => {
    const started: TrackedConsumerSpec[] = [];
    const stopped: string[] = [];
    const handle = await consumeEvents({
      handler: noop,
      createManager: (spec) => {
        started.push(spec);
        return {
          async start() {},
          async stop() {
            stopped.push(spec.durableName);
          },
        };
      },
    });

    expect(started.map((s) => s.durableName)).toEqual([
      TRK_INGRESS_DURABLE,
      TRK_GATEWAY_AUDIT_DURABLE,
      TRK_DLQ_DURABLE,
    ]);

    await handle.stop();
    expect(stopped).toEqual([
      TRK_INGRESS_DURABLE,
      TRK_GATEWAY_AUDIT_DURABLE,
      TRK_DLQ_DURABLE,
    ]);
  });
});
