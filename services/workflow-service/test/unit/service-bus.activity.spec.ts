import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";

const mockFlush = mock(() => Promise.resolve());
const mockPublish = mock(
  (_subject: string, _payload?: Uint8Array) => undefined
);
const mockHeaderSet = mock((_key: string, _value: string) => undefined);
const headerStore = new Map<string, string>();

/**
 * JetStream publish spy. Captures (subject, payload, options) so the
 * test can assert `Nats-Msg-Id` + `msgID` determinism — added in the
 * 2026-05-22 stress post-mortem (`post-mortem/POST-MORTEM.md`
 * §P1.3 fix 1).
 */
const mockJsPublish = mock(
  (_subject: string, _payload: Uint8Array, _opts?: unknown) =>
    Promise.resolve({ seq: 1 })
);

const mockJetStream = mock(() => ({ publish: mockJsPublish }));

/**
 * `$JS.API.STREAM.NAMES` probe spy. The fallback decision is made HERE, not
 * from the publish error: `js.publish()` reports a bare `503` when nothing
 * answers, and nats.js maps `503` to BOTH `NoResponders` (no stream bound —
 * falling back is right) and `JetStreamNotEnabled` (JetStream down — falling
 * back would mask an outage). Asking `streams.find(subject)` separates them.
 * Default: a stream matches, so the default is NOT to fall back.
 */
const mockStreamsFind = mock((_subject: string) =>
  Promise.resolve("SOME-STREAM")
);
const mockJetStreamManager = mock(() =>
  Promise.resolve({ streams: { find: mockStreamsFind } })
);

const mockConn = {
  isClosed: () => false,
  publish: mockPublish,
  flush: mockFlush,
  jetstream: mockJetStream,
  jetstreamManager: mockJetStreamManager,
};

const connectMock = mock(() => Promise.resolve(mockConn));

mock.module("nats", () => ({
  connect: connectMock,
  headers: () => ({
    set: (key: string, value: string) => {
      headerStore.set(key, value);
      mockHeaderSet(key, value);
    },
    get: (key: string) => headerStore.get(key),
  }),
}));

const { executeServiceBusCall } = await import(
  "../../src/temporal/activities/service-bus.activity"
);

describe("executeServiceBusCall", () => {
  beforeEach(() => {
    mockFlush.mockClear();
    mockPublish.mockClear();
    mockHeaderSet.mockClear();
    mockJsPublish.mockClear();
    mockJetStream.mockClear();
    mockStreamsFind.mockClear();
    mockJetStreamManager.mockClear();
    connectMock.mockClear();
    headerStore.clear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
    mockJsPublish.mockImplementation(() => Promise.resolve({ seq: 1 }));
  });

  it("rejects when NATS connect fails", async () => {
    connectMock.mockRejectedValueOnce(new Error("nats down"));

    await expect(
      executeServiceBusCall({ subject: "events.order" }, "tenant-a")
    ).rejects.toThrow("nats down");
  });

  it("prefers JetStream publish so Nats-Msg-Id is honoured server-side", async () => {
    await executeServiceBusCall(
      {
        subject: "events.order.created",
        payload: { id: "x1" },
        headers: { "x-trace": "abc" },
      },
      "tenant-b"
    );

    expect(mockJsPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).not.toHaveBeenCalled();
    const [subject, payload, opts] = mockJsPublish.mock.calls[0];
    expect(subject).toBe("events.order.created");
    expect(new TextDecoder().decode(payload as Uint8Array)).toBe(
      JSON.stringify({ id: "x1" })
    );
    /**
     * Both header and `msgID` option MUST be set — the JetStream
     * server honours either, but belt-and-braces guarantees dedup
     * even if a client lib version drops one.
     */
    expect((opts as { msgID?: string })?.msgID).toBeDefined();
    expect(headerStore.get("Nats-Msg-Id")).toBe(
      (opts as { msgID?: string }).msgID
    );
  });

  it("falls back to core-NATS publish when the subject has no bound stream", async () => {
    // The REAL shape of this failure: `js.publish()` reports a bare "503",
    // carrying no hint about the cause. The probe is what establishes there
    // genuinely is no stream. Before the probe existed this activity matched
    // the PUBLISH error's text for "no stream matches" — a phrase only the
    // probe ever produces — so the fallback never fired in production and
    // every ad-hoc publish failed.
    mockJsPublish.mockRejectedValueOnce(new Error("503"));
    mockStreamsFind.mockRejectedValueOnce(
      new Error("no stream matches subject")
    );

    await executeServiceBusCall({ subject: "ad-hoc.fanout" }, "tenant-c");

    expect(mockJsPublish).toHaveBeenCalledTimes(1);
    expect(mockStreamsFind).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("does NOT fall back when JetStream itself is unreachable", async () => {
    // Same bare "503" from the publish as the case above — indistinguishable
    // there. Here the probe ALSO gets no answer, which means JetStream is
    // down rather than the subject being unbound. Falling back would publish
    // over core NATS with no server-side dedup AND hide the outage, so the
    // original error has to propagate.
    mockJsPublish.mockRejectedValueOnce(new Error("503"));
    mockStreamsFind.mockRejectedValueOnce(new Error("503"));

    await expect(
      executeServiceBusCall({ subject: "events.outage" }, "t1")
    ).rejects.toThrow("503");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("propagates unknown JetStream errors instead of silently downgrading", async () => {
    // A stream DOES match (the probe's default), so the publish failed for
    // some other reason and a core-NATS fallback would paper over it.
    mockJsPublish.mockRejectedValueOnce(new Error("disk write failed"));

    await expect(
      executeServiceBusCall({ subject: "events.fail" }, "t1")
    ).rejects.toThrow("disk write failed");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  /**
   * Post-mortem (`post-mortem/POST-MORTEM.md` §P1.3 fix 1): two
   * retries of the SAME Temporal activity invocation MUST produce the
   * same dedup key so JetStream's `duplicate_window` collapses them.
   */
  it("derives the same Nats-Msg-Id for identical args (Temporal retry collapse)", async () => {
    const args = {
      subject: "events.order.created",
      payload: { id: "x1" },
      headers: { "x-trace": "abc" },
    };
    await executeServiceBusCall(args, "tenant-r");
    const firstKey = headerStore.get("Nats-Msg-Id");
    headerStore.clear();
    await executeServiceBusCall(args, "tenant-r");
    const secondKey = headerStore.get("Nats-Msg-Id");

    expect(firstKey).toBeDefined();
    expect(firstKey).toBe(secondKey);
  });

  it("derives distinct Nats-Msg-Id when payload differs", async () => {
    await executeServiceBusCall(
      { subject: "events.order.created", payload: { id: "x1" } },
      "tenant-r"
    );
    const firstKey = headerStore.get("Nats-Msg-Id");
    headerStore.clear();
    await executeServiceBusCall(
      { subject: "events.order.created", payload: { id: "x2" } },
      "tenant-r"
    );
    const secondKey = headerStore.get("Nats-Msg-Id");

    expect(firstKey).not.toBe(secondKey);
  });

  it("honours args.dedupKey override when provided (escape hatch)", async () => {
    await executeServiceBusCall(
      {
        subject: "events.order.created",
        payload: { id: "x1" },
        dedupKey: "explicit-key-123",
      },
      "tenant-r"
    );

    expect(headerStore.get("Nats-Msg-Id")).toBe("explicit-key-123");
    const [, , opts] = mockJsPublish.mock.calls[0];
    expect((opts as { msgID?: string }).msgID).toBe("explicit-key-123");
  });

  it("publishes empty payload when omitted", async () => {
    await executeServiceBusCall({ subject: "ping" }, "tenant-c");

    const [, payload] = mockJsPublish.mock.calls[0];
    expect(payload).toBeInstanceOf(Uint8Array);
    expect((payload as Uint8Array).byteLength).toBe(0);
  });
});
