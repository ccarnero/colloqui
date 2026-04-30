import { describe, it, expect } from "bun:test";
import { parseEnvelope } from "../../src/modules/aggregator/envelope-parser";

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

// Realistic subject shape: `evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v<version>`
const subj = (kind: string, channel = "whatsapp", provider = "meta") =>
  `evt.tenant-1.channel-service.messaging.${channel}.${provider}.${kind}.v1`;

describe("parseEnvelope", () => {
  const base = {
    idempotencykey: "abc-1",
    accountid: "acct-1",
    channel: "whatsapp",
    producer: "channel-service",
    time: "2026-04-23T10:00:00.000Z",
    kind: "received",
    data: { payload: { type: "text" } },
  };

  it("parses an ingress envelope into a row", () => {
    const out = parseEnvelope(
      encode(base),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.direction).toBe("ingress");
    expect(out.row.accountId).toBe("acct-1");
    expect(out.row.channel).toBe("whatsapp");
    expect(out.row.messageType).toBe("text");
    expect(out.row.idempotencyKey).toBe("abc-1");
    expect(out.row.ts.toISOString()).toBe("2026-04-23T10:00:00.000Z");
  });

  it("maps egress-like kinds to direction=egress", () => {
    const out = parseEnvelope(
      encode({ ...base, kind: "sent" }),
      subj("sent"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.direction).toBe("egress");
  });

  it("forces direction=dlq for DLQ streams regardless of kind", () => {
    // DLQ does not enforce the channel-subject filter — anything on
    // DLQ-<tenant> is a failed channel message by construction.
    const out = parseEnvelope(
      encode({ ...base, kind: "received" }),
      subj("received"),
      "DLQ-tenant-1",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.direction).toBe("dlq");
  });

  it("skips non-channel subjects on INGRESS streams without decoding", () => {
    // Simulates a workflow-service event on the tenant firehose.
    const out = parseEnvelope(
      new TextEncoder().encode("ignored"),
      "evt.tenant-1.workflow-service.workflow.internal.native.execution_completed.v1",
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("non-channel-subject");
  });

  it("skips envelopes whose producer is not channel-service on INGRESS", () => {
    // Simulates a pre-ingress webhook envelope from api-gateway that —
    // against all odds — landed on a channel-service subject. The
    // producer gate is the defense-in-depth layer that prevents such
    // envelopes from poisoning per-account usage rows (e.g. billing).
    const out = parseEnvelope(
      encode({ ...base, producer: "api-gateway", accountid: "tenant-1" }),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("non-channel-producer");
  });

  it("still accepts DLQ envelopes regardless of producer", () => {
    // DLQ-<tenant> streams only contain failed channel-service
    // envelopes, so the producer gate is not enforced there.
    const out = parseEnvelope(
      encode({ ...base, producer: "channel-service" }),
      subj("received"),
      "DLQ-tenant-1",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.direction).toBe("dlq");
  });

  it("rejects envelopes missing idempotencykey", () => {
    const { idempotencykey: _ignored, ...rest } = base;
    const out = parseEnvelope(
      encode(rest),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("missing-idempotencykey");
  });

  it("rejects envelopes missing accountid", () => {
    const { accountid: _ignored, ...rest } = base;
    const out = parseEnvelope(
      encode(rest),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("missing-accountid");
  });

  it("rejects envelopes missing channel", () => {
    const { channel: _ignored, ...rest } = base;
    const out = parseEnvelope(
      encode(rest),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("missing-channel");
  });

  it("skips intent-only kinds (send)", () => {
    const out = parseEnvelope(
      encode({ ...base, kind: "send" }),
      subj("send"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("skipped-kind");
  });

  it("rejects unknown kinds on channel subjects", () => {
    // Subject matches the channel filter but the kind is unrecognized —
    // this path now represents a legitimately malformed channel event,
    // not a cross-producer event that the pre-filter should have caught.
    const out = parseEnvelope(
      encode({ ...base, kind: "noop" }),
      subj("noop"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("unknown-kind");
  });

  it("rejects non-JSON payloads with a structured reason", () => {
    const out = parseEnvelope(
      new TextEncoder().encode("not-json"),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason.startsWith("json-parse:")).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    const out = parseEnvelope(
      encode({ ...base, time: "not-a-date" }),
      subj("received"),
      "INGRESS-tenant-1",
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("invalid-time");
  });
});
