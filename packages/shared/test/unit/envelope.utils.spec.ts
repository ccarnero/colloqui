import { describe, it, expect } from "bun:test";
import {
  canonicalJson,
  computeIdempotencyKey,
  computePayloadChecksum,
  buildSubject,
  parseSubject,
  deriveEnvelope,
  DepthExceededError,
  isCompliantEnvelope,
  MAX_DEPTH_BY_CATEGORY,
} from "../../src/envelope.utils";
import type { EventEnvelope, JsonValue } from "../../src/interfaces";

function makeIncomingEnvelope(
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  const id = "evt-123";
  return {
    specversion: "1.0",
    id,
    source: "api-gateway/events",
    type: "demo.event.v1",
    resource: "tenant/t1/demo/1",
    time: "2026-04-17T00:00:00.000Z",
    traceid: "abcd1234abcd1234abcd1234abcd1234",
    causation_id: null,
    correlation_id: id,
    tenant: "t1",
    producer: "api-gateway",
    domain: "platform",
    channel: "events",
    provider: "gateway",
    accountid: "acc-1",
    idempotencykey: "sha256:deadbeef",
    transport: { method: "stream", protocol: "internal", depth: 0 },
    data: {
      received_at: "2026-04-17T00:00:00.000Z",
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 2,
      payload_checksum: "sha256:xyz",
      payload: {},
    },
    ...overrides,
  };
}

describe("canonicalJson", () => {
  it("sorts keys alphabetically at every depth", () => {
    const left = canonicalJson({ b: 1, a: { d: 4, c: 3 } });
    const right = canonicalJson({ a: { c: 3, d: 4 }, b: 1 });
    expect(left).toBe(right);
  });

  it("emits identical strings for structurally equal arrays", () => {
    const left = canonicalJson([{ z: 9, a: 1 }, 2]);
    const right = canonicalJson([{ a: 1, z: 9 }, 2]);
    expect(left).toBe(right);
  });
});

describe("computeIdempotencyKey", () => {
  it("is deterministic for the same payload", () => {
    const payload: Record<string, JsonValue> = {
      messageId: "m1",
      from: "u1",
      text: "hello",
    };
    const a = computeIdempotencyKey(payload);
    const b = computeIdempotencyKey({ text: "hello", from: "u1", messageId: "m1" });
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  it("differs when payload content changes", () => {
    const a = computeIdempotencyKey({ x: 1 });
    const b = computeIdempotencyKey({ x: 2 });
    expect(a).not.toBe(b);
  });
});

describe("computePayloadChecksum", () => {
  it("returns sha256:<hex> for the canonical JSON", () => {
    const cs = computePayloadChecksum({ a: 1, b: [2, 3] });
    expect(cs).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("buildSubject / parseSubject", () => {
  it("round-trips an 8-token canonical subject", () => {
    const subject = buildSubject({
      tenant: "t1",
      producer: "channel-service",
      domain: "messaging",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
    });
    expect(subject).toBe("evt.t1.channel-service.messaging.telegram.telegram.received.v1");
    const parsed = parseSubject(subject);
    expect(parsed).toEqual({
      tenant: "t1",
      producer: "channel-service",
      domain: "messaging",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
      version: "v1",
    });
  });
});

describe("deriveEnvelope", () => {
  it("propagates causal chain and bumps depth", () => {
    const incoming = makeIncomingEnvelope({ id: "parent-1" });
    const derived = deriveEnvelope(incoming, {
      id: "derived-1",
      type: "derived.event.v1",
      source: "//event-processor/completion",
      resource: "tenant/t1/derived/1",
      producer: "event-processor",
      domain: "platform",
      channel: "events",
      provider: "gateway",
      accountid: "acc-1",
      payload: { foo: "bar" },
    });

    expect(derived.causation_id).toBe("parent-1");
    expect(derived.correlation_id).toBe(incoming.correlation_id);
    expect(derived.transport.depth).toBe(1);
    expect(derived.idempotencykey.startsWith("sha256:")).toBe(true);
  });

  it("throws DepthExceededError when MAX_DEPTH reached", () => {
    const maxDepth = MAX_DEPTH_BY_CATEGORY.internal_service;
    const incoming = makeIncomingEnvelope({
      transport: { method: "stream", protocol: "internal", depth: maxDepth },
    });
    expect(() =>
      deriveEnvelope(incoming, {
        id: "x",
        type: "x.v1",
        source: "//x",
        resource: "r",
        producer: "event-processor",
        domain: "platform",
        channel: "events",
        provider: "gateway",
        accountid: "acc",
        payload: { a: 1 },
        category: "internal_service",
      }),
    ).toThrow(DepthExceededError);
  });
});

describe("isCompliantEnvelope", () => {
  it("accepts a well-formed envelope", () => {
    expect(isCompliantEnvelope(makeIncomingEnvelope())).toBe(true);
  });

  it("rejects an envelope missing required fields", () => {
    const bad: Record<string, unknown> = { ...makeIncomingEnvelope() };
    delete bad.idempotencykey;
    expect(isCompliantEnvelope(bad)).toBe(false);
  });
});
