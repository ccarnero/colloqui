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
  PermanentError,
  buildDlqStreamName,
  buildDlqMessageSubject,
} from "@yoizen/shared";

async function* iter<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

interface MockConsumer {
  consume: ReturnType<typeof mock>;
}

interface PublishCall {
  subject: string;
  payload: Uint8Array;
  opts?: { headers?: { get: (k: string) => string | null }; msgID?: string };
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
    info: overrides.info ?? ({ deliveryCount: 3 } as JsMsg["info"]),
    headers: overrides.headers,
    ack,
    nak,
    term,
  } as unknown as JsMsg;
}

describe("MultiTenantConsumerManager DLQ routing", () => {
  beforeEach(() => {
    __resetEnsuredConsumerCacheForTests();
    __resetEnsuredDlqStreamCacheForTests();
  });

  it("republishes terminated message to DLQ-<tenant> with metadata headers", async () => {
    const streamName = "INGRESS-acme";
    const tenantId = "acme";

    const streamsInfo = mock(() =>
      Promise.reject(new Error("stream not found")),
    );
    const streamsAdd = mock(() => Promise.resolve({}));
    const streamsList = mock(() =>
      iter([{ config: { name: streamName } }] as Array<{
        config: { name: string };
      }>),
    );
    const consumerInfo = mock(() =>
      Promise.reject(new Error("consumer not found")),
    );
    const consumerAdd = mock(() => Promise.resolve({}));

    const jsm = {
      streams: { info: streamsInfo, add: streamsAdd, list: streamsList },
      consumers: { info: consumerInfo, add: consumerAdd },
    };

    const permanent = new PermanentError("invalid payload", "ingress");
    const msg = makeMsg({
      subject: "evt.acme.api-gateway.platform.events.gateway.metrics.v1",
    });
    const consumer = makeConsumerMock([msg]);

    const publishCalls: PublishCall[] = [];
    const publish = mock(
      (subject: string, payload: Uint8Array, opts?: PublishCall["opts"]) => {
        publishCalls.push({ subject, payload, opts });
        return Promise.resolve({ seq: 1 });
      },
    );

    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish,
    };

    const handler = mock(() => Promise.reject(permanent));

    const logger = {
      error: mock(() => {}),
      warn: mock(() => {}),
      log: mock(() => {}),
    };

    const config: IMultiTenantConsumerConfig = {
      streamPattern: /^INGRESS-/,
      durableName: "event-processor",
      filterSubject: "evt.*.api-gateway.platform.>",
      reconcileIntervalMs: 10_000_000,
    };

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      config,
      handler,
      logger,
    );

    await manager.start();

    await new Promise((r) => setTimeout(r, 30));

    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(0);

    expect(publishCalls.length).toBe(1);
    const call = publishCalls[0]!;
    expect(call.subject).toBe(
      buildDlqMessageSubject(tenantId, msg.subject),
    );
    expect(call.opts?.headers?.get("X-Dlq-Reason")).toBe("invalid payload");
    expect(call.opts?.headers?.get("X-Dlq-Stage")).toBe("ingress");
    expect(call.opts?.headers?.get("X-Dlq-Original-Subject")).toBe(
      msg.subject,
    );
    expect(call.opts?.headers?.get("X-Dlq-Stream")).toBe(
      buildDlqStreamName(tenantId),
    );
    expect(call.opts?.msgID?.startsWith("dlq:")).toBe(true);

    expect(streamsAdd.mock.calls.length).toBe(1);
    expect(streamsAdd.mock.calls[0]?.[0]?.name).toBe(
      buildDlqStreamName(tenantId),
    );

    await manager.stop();
  });

  it("falls back to nak (not term) on generic errors", async () => {
    const streamName = "INGRESS-bob";
    const streamsList = mock(() =>
      iter([{ config: { name: streamName } }] as Array<{
        config: { name: string };
      }>),
    );

    const jsm = {
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
    const msg = makeMsg({ subject: "evt.bob.anything" });
    const consumer = makeConsumerMock([msg]);

    const publish = mock(() => Promise.resolve({ seq: 1 }));
    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish,
    };

    const handler = mock(() => Promise.reject(new Error("transient 500")));
    const logger = {
      error: mock(() => {}),
      warn: mock(() => {}),
      log: mock(() => {}),
    };

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      {
        streamPattern: /^INGRESS-/,
        durableName: "event-processor",
        reconcileIntervalMs: 10_000_000,
      },
      handler,
      logger,
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect((msg.nak as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect(publish.mock.calls.length).toBe(0);

    await manager.stop();
  });

  it("skips DLQ when config.dlq.enabled = false and still terminates", async () => {
    const streamName = "INGRESS-t1";
    const streamsList = mock(() =>
      iter([{ config: { name: streamName } }] as Array<{
        config: { name: string };
      }>),
    );

    const jsm = {
      streams: {
        info: mock(() => Promise.resolve({})),
        add: mock(() => Promise.resolve({})),
        list: streamsList,
      },
      consumers: {
        info: mock(() => Promise.reject(new Error("consumer not found"))),
        add: mock(() => Promise.resolve({})),
      },
    };

    const msg = makeMsg({ subject: "evt.t1.foo" });
    const consumer = makeConsumerMock([msg]);

    const publish = mock(() => Promise.resolve({ seq: 1 }));
    const js = {
      consumers: { get: mock(() => Promise.resolve(consumer)) },
      publish,
    };

    const handler = mock(() =>
      Promise.reject(new PermanentError("bad data", "x")),
    );
    const logger = {
      error: mock(() => {}),
      warn: mock(() => {}),
      log: mock(() => {}),
    };

    const manager = new MultiTenantConsumerManager(
      jsm as never,
      js as never,
      {
        streamPattern: /^INGRESS-/,
        durableName: "event-processor",
        dlq: { enabled: false },
        reconcileIntervalMs: 10_000_000,
      },
      handler,
      logger,
    );

    await manager.start();
    await new Promise((r) => setTimeout(r, 30));

    expect((msg.term as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect(publish.mock.calls.length).toBe(0);

    await manager.stop();
  });
});
