import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { EventEnvelope } from "@yoizen/shared";
import {
  canonicalByteLength,
  canonicalJson,
  computePayloadChecksum,
} from "@yoizen/shared";
import type { JsMsg, ObjectStore } from "nats";
import {
  type IMultiTenantConsumerConfig,
  MultiTenantConsumerManager,
} from "../../src/multi-tenant-consumer-manager";
import { __resetEnsuredDlqStreamCacheForTests } from "../../src/nats-dlq";
import { __resetEnsuredConsumerCacheForTests } from "../../src/nats-durable-consumer";

async function* iter<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) {
    yield i;
  }
}

interface MockConsumer {
  consume: ReturnType<typeof mock>;
}

function makeConsumerMock(messages: JsMsg[]): MockConsumer {
  const iterator = {
    [Symbol.asyncIterator]: () => iter(messages),
    stop: mock(() => {}),
  };
  return {
    consume: mock(() => Promise.resolve(iterator)),
  };
}

function makeMsg(overrides: Partial<JsMsg> & { subject: string }): JsMsg {
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
  } as unknown as JsMsg;
}

function makePayload(): Record<string, unknown> {
  return { hello: "world", nested: { n: 1 } };
}

/** Builds a claim-check envelope (payload_inline: false) the way the producer does. */
function makeClaimCheckEnvelope(
  payload: Record<string, unknown>,
  bucket: string,
  key: string
): { envelope: EventEnvelope; storedBytes: Buffer } {
  const storedBytes = Buffer.from(canonicalJson(payload));
  const checksum = computePayloadChecksum(payload);
  const envelope: EventEnvelope = {
    specversion: "1.0",
    id: "01JQFLAG",
    source: "channel-service/accounts/acc-1",
    type: "io.yoizen.messaging.whatsapp.meta.received.v1",
    resource: "tenant/acme/account/acc-1/channel/whatsapp/provider/meta",
    time: new Date().toISOString(),
    traceid: "abc123",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "acme",
    producer: "channel-service",
    domain: "messaging",
    channel: "whatsapp",
    provider: "meta",
    accountid: "acc-1",
    idempotencykey: "sha256:aabbcc",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: false,
      payload_ref: `nats://objstore/${bucket}/${key}`,
      payload_bytes: canonicalByteLength(payload),
      payload_checksum: checksum,
      payload: null,
    },
  };
  return { envelope, storedBytes };
}

function baseConfig(
  overrides: Partial<IMultiTenantConsumerConfig> = {}
): IMultiTenantConsumerConfig {
  return {
    streamPattern: /^INGRESS-/,
    durableName: "event-processor",
    reconcileIntervalMs: 10_000_000,
    ...overrides,
  };
}

function makeJsm(streamName: string) {
  const streamsList = mock(() =>
    iter([{ config: { name: streamName } }] as Array<{
      config: { name: string };
    }>)
  );
  return {
    streams: {
      info: mock(() => Promise.reject(new Error("stream not found"))),
      add: mock(() => Promise.resolve({})),
      list: streamsList,
    },
    consumers: {
      info: mock(() => Promise.reject(new Error("consumer not found"))),
      add: mock(() => Promise.resolve({})),
    },
  };
}

const logger = {
  error: mock(() => {}),
  warn: mock(() => {}),
  log: mock(() => {}),
};

describe("MultiTenantConsumerManager resolveClaimChecks flag", () => {
  beforeEach(() => {
    __resetEnsuredConsumerCacheForTests();
    __resetEnsuredDlqStreamCacheForTests();
  });

  it("default (unset) resolves claim-checks and hands the inner handler an inflated envelope", async () => {
    const streamName = "INGRESS-acme";
    const payload = makePayload();
    const bucket = "PAYLOAD-acme";
    const key = "01JQFLAG-payload";
    const { envelope, storedBytes } = makeClaimCheckEnvelope(
      payload,
      bucket,
      key
    );
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const msg = makeMsg({
      subject: "evt.acme.channel.messaging.v1",
      data: bytes,
    });
    const consumer = makeConsumerMock([msg]);

    const store: ObjectStore = {
      getBlob: async (name: string) => (name === key ? storedBytes : null),
    } as unknown as ObjectStore;

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      views: { os: mock(() => Promise.resolve(store)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
    };

    let receivedData: Uint8Array | undefined;
    const handler = mock((m: JsMsg) => {
      receivedData = m.data;
      return Promise.resolve();
    });

    const manager = new MultiTenantConsumerManager(
      makeJsm(streamName) as never,
      js as never,
      baseConfig(),
      handler,
      logger
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(handler.mock.calls.length).toBe(1);
    const inflatedEnvelope = JSON.parse(
      Buffer.from(receivedData!).toString("utf8")
    ) as EventEnvelope;
    expect(inflatedEnvelope.data.payload_inline).toBe(true);
    expect(inflatedEnvelope.data.payload).toEqual(payload);
    expect((js.views.os as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    await manager.stop();
  });

  it("resolveClaimChecks: true re-throws (nak path) on a resolve failure, same as default", async () => {
    const streamName = "INGRESS-acme2";
    const payload = makePayload();
    const bucket = "PAYLOAD-acme2";
    const key = "missing-key";
    const { envelope } = makeClaimCheckEnvelope(payload, bucket, key);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const msg = makeMsg({
      subject: "evt.acme2.channel.messaging.v1",
      data: bytes,
    });
    const consumer = makeConsumerMock([msg]);

    const emptyStore: ObjectStore = {
      getBlob: async () => null,
    } as unknown as ObjectStore;

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      views: { os: mock(() => Promise.resolve(emptyStore)) },
      publish: mock(() => Promise.resolve({ seq: 1 })),
    };

    const handler = mock(() => Promise.resolve());

    const manager = new MultiTenantConsumerManager(
      makeJsm(streamName) as never,
      js as never,
      baseConfig({ resolveClaimChecks: true }),
      handler,
      logger
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    // Inner handler never called — resolution failed and the runner naks.
    expect(handler.mock.calls.length).toBe(0);
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    await manager.stop();
  });

  it("resolveClaimChecks: false passes the slim envelope through untouched, no resolution attempted, no throw on what would have been a failure", async () => {
    const streamName = "INGRESS-acme3";
    const payload = makePayload();
    const bucket = "PAYLOAD-acme3";
    const key = "missing-key"; // would fail resolution if attempted
    const { envelope } = makeClaimCheckEnvelope(payload, bucket, key);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    const msg = makeMsg({
      subject: "evt.acme3.channel.messaging.v1",
      data: bytes,
    });
    const consumer = makeConsumerMock([msg]);

    const osSpy = mock(() =>
      Promise.reject(new Error("should never be called"))
    );
    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      views: { os: osSpy },
      publish: mock(() => Promise.resolve({ seq: 1 })),
    };

    let receivedData: Uint8Array | undefined;
    const handler = mock((m: JsMsg) => {
      receivedData = m.data;
      return Promise.resolve();
    });

    const manager = new MultiTenantConsumerManager(
      makeJsm(streamName) as never,
      js as never,
      baseConfig({ resolveClaimChecks: false }),
      handler,
      logger
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    // Inner handler called with the untouched slim bytes — no resolution attempt.
    expect(handler.mock.calls.length).toBe(1);
    expect(osSpy.mock.calls.length).toBe(0);
    const slimEnvelope = JSON.parse(
      Buffer.from(receivedData!).toString("utf8")
    ) as EventEnvelope;
    expect(slimEnvelope.data.payload_inline).toBe(false);
    expect(slimEnvelope.data.payload).toBeNull();

    // No nak/term — handler resolved normally.
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    await manager.stop();
  });
});
