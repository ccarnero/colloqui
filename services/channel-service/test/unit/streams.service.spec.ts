import { describe, it, expect, mock } from "bun:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  StreamsService,
  extractEnvelopeAccountId,
} from "../../src/modules/streams/streams.service";

function makeInfo(overrides: Record<string, unknown> = {}): unknown {
  return {
    config: {
      subjects: ["ingress.>"],
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
      max_bytes: 1_073_741_824,
      ...(overrides.config as Record<string, unknown> | undefined),
    },
    state: {
      messages: 100,
      bytes: 1024,
      first_seq: 1,
      last_seq: 100,
      first_ts: "2026-04-20T00:00:00Z",
      last_ts: "2026-04-23T00:00:00Z",
      consumer_count: 2,
      ...(overrides.state as Record<string, unknown> | undefined),
    },
  };
}

function makeJsm(infoByStream: Map<string, unknown>) {
  const deleted: Array<[string, string]> = [];
  return {
    deleted,
    jsm: {
      streams: {
        info: mock(async (name: string) => {
          const v = infoByStream.get(name);
          if (v === undefined) throw new Error("stream not found");
          return v;
        }),
      },
      consumers: {
        add: mock(() => Promise.resolve({})),
        delete: mock((stream: string, name: string) => {
          deleted.push([stream, name]);
          return Promise.resolve();
        }),
      },
    },
  };
}

function makeJs(
  messages: ReadonlyArray<{
    readonly seq: number;
    readonly subject: string;
    readonly data: Uint8Array;
  }>,
  fetchCalls: Array<{ max_messages?: number }> = [],
) {
  const iter = {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) {
        yield {
          ...msg,
          headers: null,
          info: { timestampNanos: "1714000000000000000" },
        };
      }
    },
  };
  return {
    consumers: {
      get: mock(() =>
        Promise.resolve({
          fetch: mock((opts: { max_messages?: number }) => {
            fetchCalls.push(opts);
            return Promise.resolve(iter);
          }),
        }),
      ),
    },
  };
}

describe("extractEnvelopeAccountId", () => {
  it("returns the account id when present", () => {
    expect(
      extractEnvelopeAccountId({ accountid: "a1", channel: "telegram" }),
    ).toBe("a1");
  });
  it("returns null when missing or empty", () => {
    expect(extractEnvelopeAccountId({})).toBeNull();
    expect(extractEnvelopeAccountId({ accountid: "" })).toBeNull();
    expect(extractEnvelopeAccountId(null)).toBeNull();
  });
});

describe("StreamsService", () => {
  it("lists existing ingress + dlq streams with summaries", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
      ["DLQ-tenant-1", makeInfo({ state: { messages: 3 } })],
    ]);
    const { jsm } = makeJsm(infos);
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );
    const result = await service.listStreams("tenant-1");
    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe("ingress");
    expect(result[1]!.kind).toBe("dlq");
    expect(result[0]!.consumerCount).toBe(2);
  });

  it("omits streams that do not exist", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm } = makeJsm(infos);
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );
    const result = await service.listStreams("tenant-1");
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("ingress");
  });

  it("rejects unknown stream keys", async () => {
    const { jsm } = makeJsm(new Map());
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );
    let err: unknown = null;
    try {
      await service.getMessages("tenant-1", "bogus", undefined, 5);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it("throws NotFound when stream does not exist", async () => {
    const { jsm } = makeJsm(new Map());
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );
    let err: unknown = null;
    try {
      await service.getMessages("tenant-1", "ingress", undefined, 5);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotFoundException);
  });

  it("creates an ephemeral consumer scoped by filter_subject and deletes it afterwards", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm, deleted } = makeJsm(infos);
    const js = makeJs([
      {
        seq: 42,
        subject: "ingress.whatsapp.received",
        data: new TextEncoder().encode(JSON.stringify({ hello: "world" })),
      },
    ]);
    const service = new StreamsService(jsm as never, js as never);

    const out = await service.getMessages(
      "tenant-1",
      "ingress",
      "ingress.whatsapp.*",
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.seq).toBe(42);
    expect(out[0]!.data).toEqual({ hello: "world" });

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    expect(addCalls).toHaveLength(1);
    const cfg = addCalls[0]![1] as { filter_subject?: string };
    expect(cfg.filter_subject).toBe("ingress.whatsapp.*");
    await new Promise((r) => setTimeout(r, 0));
    expect(deleted[0]![0]).toBe("INGRESS-TENANT-1");
  });

  it("post-filters by accountId and requests a larger fetch batch", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm, deleted } = makeJsm(infos);
    const fetchCalls: Array<{ max_messages?: number }> = [];
    const enc = (o: Record<string, unknown>) =>
      new TextEncoder().encode(JSON.stringify(o));
    const js = makeJs(
      [
        { seq: 1, subject: "s1", data: enc({ accountid: "other" }) },
        { seq: 2, subject: "s2", data: enc({ accountid: "target" }) },
        { seq: 3, subject: "s3", data: enc({ accountid: "target" }) },
      ],
      fetchCalls,
    );
    const service = new StreamsService(jsm as never, js as never);

    const out = await service.getMessages(
      "tenant-1",
      "ingress",
      undefined,
      2,
      "last-per-subject",
      "target",
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.seq).toBe(2);
    expect(out[1]!.seq).toBe(3);
    expect(fetchCalls[0]!.max_messages).toBe(8);
    await new Promise((r) => setTimeout(r, 0));
    expect(deleted[0]![0]).toBe("INGRESS-TENANT-1");
  });

  it("tail mode uses scanCap for opt_start_seq when accountId is set", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm } = makeJsm(infos);
    const js = makeJs([]);
    const service = new StreamsService(jsm as never, js as never);

    await service.getMessages(
      "tenant-1",
      "ingress",
      undefined,
      10,
      "tail",
      "acct-1",
    );

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const cfg = addCalls[0]![1] as { opt_start_seq?: number };
    // last_seq=100, scanCap=40 => start at 61
    expect(cfg.opt_start_seq).toBe(61);
  });

  it("falls back to the stream's first subject when no filter is provided (last-per-subject)", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm } = makeJsm(infos);
    const js = makeJs([]);
    const service = new StreamsService(jsm as never, js as never);

    await service.getMessages("tenant-1", "ingress", undefined, 5);

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    expect(addCalls).toHaveLength(1);
    const cfg = addCalls[0]![1] as {
      filter_subject?: string;
      deliver_policy?: string;
    };
    expect(cfg.filter_subject).toBe("ingress.>");
    expect(cfg.deliver_policy).toBe("last_per_subject");
  });

  it("rejects subject filters that are not a subset of the stream's bound subjects", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm } = makeJsm(infos);
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );

    let err: unknown = null;
    try {
      await service.getMessages(
        "tenant-1",
        "ingress",
        "evt.other-tenant.>",
        5,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    expect(addCalls).toHaveLength(0);
  });

  it("tail mode uses StartSequence with computed opt_start_seq and no filter", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm } = makeJsm(infos);
    const js = makeJs([]);
    const service = new StreamsService(jsm as never, js as never);

    await service.getMessages("tenant-1", "ingress", undefined, 10, "tail");

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    expect(addCalls).toHaveLength(1);
    const cfg = addCalls[0]![1] as {
      deliver_policy?: string;
      opt_start_seq?: number;
      filter_subject?: string;
    };
    expect(cfg.deliver_policy).toBe("by_start_sequence");
    // last_seq=100, cap=10 => start at 91
    expect(cfg.opt_start_seq).toBe(91);
    expect(cfg.filter_subject).toBeUndefined();
  });

  it("tail mode clamps opt_start_seq to first_seq when the stream is short", async () => {
    const infos = new Map<string, unknown>([
      [
        "INGRESS-TENANT-1",
        makeInfo({ state: { first_seq: 5, last_seq: 8 } }),
      ],
    ]);
    const { jsm } = makeJsm(infos);
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );

    await service.getMessages("tenant-1", "ingress", undefined, 50, "tail");

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const cfg = addCalls[0]![1] as { opt_start_seq?: number };
    // last_seq - cap + 1 = 8 - 50 + 1 = -41, clamped to first_seq=5
    expect(cfg.opt_start_seq).toBe(5);
  });

  it("tail mode forwards a valid subject filter alongside StartSequence", async () => {
    const infos = new Map<string, unknown>([
      ["INGRESS-TENANT-1", makeInfo()],
    ]);
    const { jsm } = makeJsm(infos);
    const service = new StreamsService(
      jsm as never,
      makeJs([]) as never,
    );

    await service.getMessages(
      "tenant-1",
      "ingress",
      "ingress.whatsapp.*",
      5,
      "tail",
    );

    const addCalls = (jsm.consumers.add as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls;
    const cfg = addCalls[0]![1] as {
      deliver_policy?: string;
      filter_subject?: string;
    };
    expect(cfg.deliver_policy).toBe("by_start_sequence");
    expect(cfg.filter_subject).toBe("ingress.whatsapp.*");
  });
});
