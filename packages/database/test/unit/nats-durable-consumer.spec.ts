import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  ensureDurableConsumer,
  getDurableConsumer,
  __resetEnsuredConsumerCacheForTests,
} from "../../src/nats-durable-consumer";
import { AckPolicy, DeliverPolicy, ReplayPolicy, nanos } from "nats";

type ConsumerAddArgs = [string, Record<string, unknown>];
type ConsumerUpdateArgs = [string, string, Record<string, unknown>];

interface MockJsm {
  consumers: {
    info: ReturnType<typeof mock>;
    add: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
}

interface IExistingConsumerCfg {
  readonly ack_wait?: number;
  readonly max_deliver?: number;
  readonly max_ack_pending?: number;
  readonly backoff?: readonly number[];
  readonly description?: string;
}

function makeJsmMock(opts: {
  consumerExists: boolean;
  existingCfg?: IExistingConsumerCfg;
}): MockJsm {
  const info = mock((_stream: string, _durable: string) => {
    if (opts.consumerExists) {
      return Promise.resolve({
        name: _durable,
        stream_name: _stream,
        config: {
          ack_wait: opts.existingCfg?.ack_wait ?? nanos(60_000),
          max_deliver: opts.existingCfg?.max_deliver ?? 5,
          max_ack_pending: opts.existingCfg?.max_ack_pending ?? 1000,
          backoff: opts.existingCfg?.backoff ?? [
            nanos(60_000),
            nanos(120_000),
            nanos(300_000),
            nanos(600_000),
          ],
          description: opts.existingCfg?.description,
        },
      });
    }
    return Promise.reject(new Error("consumer not found"));
  });

  const add = mock(
    (_stream: string, _cfg: Record<string, unknown>) =>
      Promise.resolve({ name: _cfg.durable_name as string }),
  );

  const update = mock(
    (_stream: string, _durable: string, _cfg: Record<string, unknown>) =>
      Promise.resolve({ name: _durable }),
  );

  return {
    consumers: { info, add, update },
  };
}

describe("ensureDurableConsumer", () => {
  beforeEach(() => {
    __resetEnsuredConsumerCacheForTests();
  });

  it("creates the consumer with AckPolicy.Explicit + DeliverPolicy.All + ReplayPolicy.Instant when missing", async () => {
    const jsm = makeJsmMock({ consumerExists: false });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "channel-egress",
      filterSubject: "cmd.acme.channel-service.channel.send.command.v1",
    });

    expect(jsm.consumers.add).toHaveBeenCalledTimes(1);
    const args = jsm.consumers.add.mock.calls[0] as ConsumerAddArgs;
    expect(args[0]).toBe("INGRESS-acme");

    const cfg = args[1];
    expect(cfg.durable_name).toBe("channel-egress");
    expect(cfg.ack_policy).toBe(AckPolicy.Explicit);
    expect(cfg.deliver_policy).toBe(DeliverPolicy.All);
    expect(cfg.replay_policy).toBe(ReplayPolicy.Instant);
    expect(cfg.max_deliver).toBe(5);
    expect(cfg.max_ack_pending).toBe(1000);
    expect(cfg.ack_wait).toBe(nanos(60_000));
    expect(cfg.filter_subject).toBe(
      "cmd.acme.channel-service.channel.send.command.v1",
    );
    expect(cfg.deliver_group).toBe("channel-egress");
    expect(cfg.backoff).toEqual([
      nanos(60_000),
      nanos(120_000),
      nanos(300_000),
      nanos(600_000),
    ]);
  });

  it("is idempotent: does not re-create on second call for same (stream, durable)", async () => {
    const jsm = makeJsmMock({ consumerExists: false });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "channel-egress",
      filterSubject: "foo",
    });
    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "channel-egress",
      filterSubject: "foo",
    });

    expect(jsm.consumers.add).toHaveBeenCalledTimes(1);
  });

  it("skips creation when the consumer already exists and matches desired config", async () => {
    const jsm = makeJsmMock({
      consumerExists: true,
      existingCfg: {
        ack_wait: nanos(60_000),
        max_deliver: 5,
        max_ack_pending: 1000,
      },
    });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "workflow-triggers",
      filterSubject: "evt.acme.channel-service.chat.message.received.v1",
    });

    expect(jsm.consumers.info).toHaveBeenCalledTimes(1);
    expect(jsm.consumers.add).toHaveBeenCalledTimes(0);
    expect(jsm.consumers.update).toHaveBeenCalledTimes(0);
  });

  it("reconciles ack_wait when an existing durable drifts from the desired value", async () => {
    const jsm = makeJsmMock({
      consumerExists: true,
      existingCfg: {
        ack_wait: nanos(1_000),
        max_deliver: 5,
        max_ack_pending: 1000,
      },
    });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "channel-egress",
      filterSubject: "evt.acme.channel-service.messaging.*.*.send.v1",
    });

    expect(jsm.consumers.add).toHaveBeenCalledTimes(0);
    expect(jsm.consumers.update).toHaveBeenCalledTimes(1);
    const args = jsm.consumers.update.mock.calls[0] as ConsumerUpdateArgs;
    expect(args[0]).toBe("INGRESS-acme");
    expect(args[1]).toBe("channel-egress");
    expect(args[2].ack_wait).toBe(nanos(60_000));
    expect(args[2].max_deliver).toBe(5);
    expect(args[2].max_ack_pending).toBe(1000);
  });

  it("reconciles max_deliver when the existing durable differs", async () => {
    const jsm = makeJsmMock({
      consumerExists: true,
      existingCfg: {
        ack_wait: nanos(60_000),
        max_deliver: 5,
        max_ack_pending: 1000,
      },
    });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "channel-egress",
      filterSubject: "evt.>",
      maxDeliver: 2,
      backoffMs: [2_000],
    });

    expect(jsm.consumers.update).toHaveBeenCalledTimes(1);
    const args = jsm.consumers.update.mock.calls[0] as ConsumerUpdateArgs;
    expect(args[2].max_deliver).toBe(2);
    expect(args[2].backoff).toEqual([nanos(2_000)]);
  });

  it("reconciles backoff when the existing array differs", async () => {
    const jsm = makeJsmMock({
      consumerExists: true,
      existingCfg: {
        ack_wait: nanos(60_000),
        max_deliver: 5,
        max_ack_pending: 1000,
        backoff: [nanos(1_000)],
      },
    });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "channel-egress",
      filterSubject: "evt.>",
    });

    expect(jsm.consumers.update).toHaveBeenCalledTimes(1);
    const args = jsm.consumers.update.mock.calls[0] as ConsumerUpdateArgs;
    expect(args[2].backoff).toEqual([
      nanos(60_000),
      nanos(120_000),
      nanos(300_000),
      nanos(600_000),
    ]);
  });

  it("defaults deliver_group to durableName when not provided", async () => {
    const jsm = makeJsmMock({ consumerExists: false });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "event-processor",
      filterSubject: "evt.>",
    });

    const cfg = (jsm.consumers.add.mock.calls[0] as ConsumerAddArgs)[1];
    expect(cfg.deliver_group).toBe("event-processor");
  });

  it("respects an explicit deliverGroup when supplied", async () => {
    const jsm = makeJsmMock({ consumerExists: false });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "audit-gateway",
      filterSubject: "evt.>",
      deliverGroup: "gateway-audit",
    });

    const cfg = (jsm.consumers.add.mock.calls[0] as ConsumerAddArgs)[1];
    expect(cfg.deliver_group).toBe("gateway-audit");
  });

  it("translates ackWaitMs and backoffMs into nanoseconds", async () => {
    const jsm = makeJsmMock({ consumerExists: false });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "metrics",
      filterSubject: "evt.>",
      ackWaitMs: 10_000,
      backoffMs: [500, 2_000],
    });

    const cfg = (jsm.consumers.add.mock.calls[0] as ConsumerAddArgs)[1];
    expect(cfg.ack_wait).toBe(nanos(10_000));
    expect(cfg.backoff).toEqual([nanos(500), nanos(2_000)]);
  });

  it("propagates unexpected errors from consumers.info (does not silently create)", async () => {
    const jsm: MockJsm = {
      consumers: {
        info: mock(() =>
          Promise.reject(new Error("nats connection reset")),
        ),
        add: mock(() => Promise.resolve({})),
        update: mock(() => Promise.resolve({})),
      },
    };

    await expect(
      ensureDurableConsumer(jsm as never, {
        stream: "INGRESS-acme",
        durableName: "webhook-dispatcher",
        filterSubject: "evt.>",
      }),
    ).rejects.toThrow("nats connection reset");
    expect(jsm.consumers.add).toHaveBeenCalledTimes(0);
  });

  it("passes filter_subjects (plural) when provided", async () => {
    const jsm = makeJsmMock({ consumerExists: false });

    await ensureDurableConsumer(jsm as never, {
      stream: "INGRESS-acme",
      durableName: "audit-both",
      filterSubjects: ["evt.>", "cmd.>"],
    });

    const cfg = (jsm.consumers.add.mock.calls[0] as ConsumerAddArgs)[1];
    expect(cfg.filter_subjects).toEqual(["evt.>", "cmd.>"]);
    expect(cfg.filter_subject).toBeUndefined();
  });
});

describe("getDurableConsumer", () => {
  it("delegates to js.consumers.get with the stream + durable", async () => {
    const stub = { consume: () => undefined };
    const get = mock((_stream: string, _durable: string) =>
      Promise.resolve(stub),
    );
    const js = { consumers: { get } };

    const consumer = await getDurableConsumer(
      js as never,
      "INGRESS-acme",
      "workflow-triggers",
    );

    expect(consumer).toBe(stub);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]).toEqual(["INGRESS-acme", "workflow-triggers"]);
  });
});
