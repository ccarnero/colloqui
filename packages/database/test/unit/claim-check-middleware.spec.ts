import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { JsMsg } from "nats";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "../../src/multi-tenant-consumer-manager";
import { __resetEnsuredConsumerCacheForTests } from "../../src/nats-durable-consumer";
import { __resetEnsuredDlqStreamCacheForTests } from "../../src/nats-dlq";
import {
  canonicalJson,
  computePayloadChecksum,
  isCompliantEnvelope,
} from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";

// ---------------------------------------------------------------------------
// Test helpers (mirrors the DLQ spec patterns)
// ---------------------------------------------------------------------------

async function* iter<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

function makeConsumerMock(messages: JsMsg[]) {
  const iterator = {
    [Symbol.asyncIterator]: () => iter(messages),
    stop: mock(() => {}),
  };
  return {
    consume: mock(() => Promise.resolve(iterator)),
  };
}

function makeMsg(
  overrides: Partial<JsMsg> & {
    subject: string;
    data?: Uint8Array;
  },
): JsMsg {
  const ack = mock(() => {});
  const nak = mock(() => {});
  const term = mock(() => {});
  return {
    subject: overrides.subject,
    data: overrides.data ?? new TextEncoder().encode("{}"),
    seq: overrides.seq ?? 1,
    info: overrides.info ?? ({ deliveryCount: 1 } as JsMsg["info"]),
    headers: overrides.headers,
    ack,
    nak,
    term,
    sid: 0,
  } as unknown as JsMsg;
}

/** Builds a minimal compliant EventEnvelope with the given data fields. */
function makeEnvelope(
  payload: Record<string, unknown> | null,
  payloadInline: boolean,
  payloadRef: string | null = null,
  payloadChecksum = "sha256:0000",
): EventEnvelope {
  return {
    specversion: "1.0",
    id: "env-test",
    source: "//channel-service/accounts/acc-1",
    type: "io.yoizen.messaging.whatsapp.meta.received.v1",
    resource: "tenant/t1/account/acc-1/channel/whatsapp/provider/meta",
    time: new Date().toISOString(),
    traceid: "trace-1",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "t1",
    producer: "channel-service",
    domain: "messaging",
    channel: "whatsapp",
    provider: "meta",
    accountid: "acc-1",
    idempotencykey: "sha256:aabb",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: payloadInline,
      payload_ref: payloadRef,
      payload_bytes: 42,
      payload_checksum: payloadChecksum,
      payload,
    },
  };
}

/** Builds a full JsM with inline envelope (common case). */
function makeInlineMsg(subject: string): JsMsg {
  const envelope = makeEnvelope({ hello: "world" }, true);
  return makeMsg({
    subject,
    data: new TextEncoder().encode(JSON.stringify(envelope)),
  });
}

/**
 * Builds a claim-check JsMsg using the correct invariant:
 * storedBytes = canonicalJson(payload) as UTF-8,
 * checksum = sha256(storedBytes).
 */
function makeClaimCheckMsg(
  subject: string,
  payload: Record<string, unknown>,
  bucket: string,
  key: string,
): { msg: JsMsg; storedBytes: Uint8Array; checksum: string } {
  const canonicalBytes = Buffer.from(canonicalJson(payload));
  const checksum = computePayloadChecksum(payload);
  const payloadRef = `nats://objstore/${bucket}/${key}`;
  const envelope = makeEnvelope(null, false, payloadRef, checksum);
  const msgData = new TextEncoder().encode(JSON.stringify(envelope));
  return {
    msg: makeMsg({ subject, data: msgData }),
    storedBytes: canonicalBytes,
    checksum,
  };
}

function makeJsmMock(streamName: string) {
  return {
    streams: {
      info: mock(() => Promise.reject(new Error("stream not found"))),
      add: mock(() => Promise.resolve({})),
      list: mock(() =>
        iter([{ config: { name: streamName } }] as Array<{
          config: { name: string };
        }>),
      ),
    },
    consumers: {
      info: mock(() => Promise.reject(new Error("consumer not found"))),
      add: mock(() => Promise.resolve({})),
    },
  };
}

function makeLogger() {
  return {
    error: mock(() => {}),
    warn: mock(() => {}),
    log: mock(() => {}),
  };
}

const DEFAULT_CONFIG: IMultiTenantConsumerConfig = {
  streamPattern: /^INGRESS-/,
  durableName: "test-durable",
  reconcileIntervalMs: 10_000_000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiTenantConsumerManager claim-check middleware", () => {
  beforeEach(() => {
    __resetEnsuredConsumerCacheForTests();
    __resetEnsuredDlqStreamCacheForTests();
  });

  it("passes inline envelope through byte-identical without calling getBlob", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);
    const msg = makeInlineMsg("evt.t1.channel-service.messaging.whatsapp.meta.received.v1");
    const consumer = makeConsumerMock([msg]);
    const getBlob = mock(async () => null);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: { os: mock(async () => ({ getBlob })) },
    };

    const receivedData: Uint8Array[] = [];
    const handler = mock(async (m: JsMsg) => {
      receivedData.push(m.data);
    });

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(1);
    expect(getBlob.mock.calls.length).toBe(0);
    // Data must be byte-identical to what was sent
    const original = msg.data;
    expect(receivedData[0]).toBe(original);

    await manager.stop();
  });

  it("resolves claim-check envelope and handler sees inflated payload_inline:true", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);
    const payload = { messageId: "m1", text: "hello" };
    const bucket = "PAYLOAD-t1";
    const key = "env-test-payload";
    const { msg, storedBytes } = makeClaimCheckMsg(
      "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      payload,
      bucket,
      key,
    );
    const consumer = makeConsumerMock([msg]);

    const getBlob = mock(async (k: string) => {
      if (k === key) return storedBytes;
      return null;
    });

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: { os: mock(async () => ({ getBlob })) },
    };

    const handlerAck = mock(() => {});
    let seenEnvelope: EventEnvelope | null = null;
    const handler = mock(async (m: JsMsg) => {
      seenEnvelope = JSON.parse(Buffer.from(m.data).toString("utf8")) as EventEnvelope;
      handlerAck();
    });

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(1);
    expect(seenEnvelope).not.toBeNull();
    expect(seenEnvelope!.data.payload_inline).toBe(true);
    expect(seenEnvelope!.data.payload_ref).toBeNull();
    expect(seenEnvelope!.data.payload).toEqual(payload);
    // isCompliantEnvelope must still pass
    expect(isCompliantEnvelope(seenEnvelope)).toBe(true);

    await manager.stop();
  });

  it("ack/nak delegate to the underlying message via Proxy", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);
    const payload = { x: 1 };
    const bucket = "PAYLOAD-t1";
    const key = "proxy-test-payload";
    const { msg, storedBytes } = makeClaimCheckMsg(
      "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      payload,
      bucket,
      key,
    );
    const consumer = makeConsumerMock([msg]);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: {
        os: mock(async () => ({
          getBlob: async (k: string) => (k === key ? storedBytes : null),
        })),
      },
    };

    const handler = mock(async (_m: JsMsg) => {
      // handler completes successfully → runner calls msg.ack()
    });

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    // ack should have been called on the ORIGINAL underlying message
    expect((msg.ack as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    await manager.stop();
  });

  it("naks on checksum mismatch (ClaimCheckResolveError — not PermanentError)", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);
    const payload = { x: 1 };
    const bucket = "PAYLOAD-t1";
    const key = "mismatch-test";
    const { msg } = makeClaimCheckMsg(
      "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      payload,
      bucket,
      key,
    );
    const consumer = makeConsumerMock([msg]);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: {
        os: mock(async () => ({
          // Return tampered bytes — checksum will not match
          getBlob: async () => Buffer.from("tampered"),
        })),
      },
    };

    const handler = mock(async () => {});
    const logger = makeLogger();

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      logger,
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(0);
    // nak path (not term — ClaimCheckResolveError is NOT a PermanentError)
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    await manager.stop();
  });

  it("naks when getBlob returns null (blob_not_found)", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);
    const payload = { x: 1 };
    const bucket = "PAYLOAD-t1";
    const key = "missing-key";
    const { msg } = makeClaimCheckMsg(
      "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      payload,
      bucket,
      key,
    );
    const consumer = makeConsumerMock([msg]);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: {
        os: mock(async () => ({
          getBlob: async () => null,
        })),
      },
    };

    const handler = mock(async () => {});

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(0);
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    await manager.stop();
  });

  it("naks when getBlob rejects", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);
    const payload = { x: 1 };
    const bucket = "PAYLOAD-t1";
    const key = "error-key";
    const { msg } = makeClaimCheckMsg(
      "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      payload,
      bucket,
      key,
    );
    const consumer = makeConsumerMock([msg]);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: {
        os: mock(async () => ({
          getBlob: async () => {
            throw new Error("network error");
          },
        })),
      },
    };

    const handler = mock(async () => {});

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(0);
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    await manager.stop();
  });

  it("passes through garbage bytes containing the marker substring", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);

    // Bytes that contain the marker but are not valid JSON
    const garbageWithMarker = Buffer.from(
      'xxx"payload_inline":false,garbage!!!',
    );
    const msg = makeMsg({
      subject: "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      data: new Uint8Array(garbageWithMarker),
    });
    const consumer = makeConsumerMock([msg]);
    const getBlob = mock(async () => null);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: { os: mock(async () => ({ getBlob })) },
    };

    const receivedData: Uint8Array[] = [];
    const handler = mock(async (m: JsMsg) => {
      receivedData.push(m.data);
    });

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    // Handler should have been called with the original bytes
    expect(handler.mock.calls.length).toBe(1);
    expect(getBlob.mock.calls.length).toBe(0);
    // Bytes pass through, no throw
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    await manager.stop();
  });

  it("passes through parseable JSON with a real payload_inline:false key that is not an envelope", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);

    // The marker matches and JSON.parse succeeds, so only the
    // isCompliantEnvelope guard can stop resolution here.
    const notAnEnvelope = {
      payload_inline: false,
      not_an_envelope: true,
    };
    const rawBytes = new TextEncoder().encode(JSON.stringify(notAnEnvelope));
    const msg = makeMsg({
      subject: "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      data: rawBytes,
    });
    const consumer = makeConsumerMock([msg]);
    const getBlob = mock(async () => null);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: { os: mock(async () => ({ getBlob })) },
    };

    const receivedData: Uint8Array[] = [];
    const handler = mock(async (m: JsMsg) => {
      receivedData.push(m.data);
    });

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(1);
    expect(receivedData[0]).toBe(rawBytes);
    expect(getBlob.mock.calls.length).toBe(0);
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    await manager.stop();
  });

  it("passes through a compliant inline envelope whose payload contains a nested payload_inline:false key", async () => {
    const streamName = "INGRESS-t1";
    const jsm = makeJsmMock(streamName);

    // Marker matches (nested key serializes unescaped) and isCompliantEnvelope
    // passes, so only the data.payload_inline === false guard stops resolution.
    const envelope = makeEnvelope({ nested: { payload_inline: false } }, true);
    const rawBytes = new TextEncoder().encode(JSON.stringify(envelope));
    const msg = makeMsg({
      subject: "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
      data: rawBytes,
    });
    const consumer = makeConsumerMock([msg]);
    const getBlob = mock(async () => null);

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
      views: { os: mock(async () => ({ getBlob })) },
    };

    const receivedData: Uint8Array[] = [];
    const handler = mock(async (m: JsMsg) => {
      receivedData.push(m.data);
    });

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      DEFAULT_CONFIG,
      handler,
      makeLogger(),
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(1);
    expect(receivedData[0]).toBe(rawBytes);
    expect(getBlob.mock.calls.length).toBe(0);

    await manager.stop();
  });
});
