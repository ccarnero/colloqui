import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";

const mockFlush = mock(() => Promise.resolve());
const mockPublish = mock(
  (_subject: string, _payload?: Uint8Array) => undefined,
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
    Promise.resolve({ seq: 1 }),
);

const mockJetStream = mock(() => ({ publish: mockJsPublish }));

const mockConn = {
  isClosed: () => false,
  publish: mockPublish,
  flush: mockFlush,
  jetstream: mockJetStream,
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
    connectMock.mockClear();
    headerStore.clear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
    mockJsPublish.mockImplementation(() => Promise.resolve({ seq: 1 }));
  });

  it("rejects when NATS connect fails", async () => {
    connectMock.mockRejectedValueOnce(new Error("nats down"));

    await expect(
      executeServiceBusCall({ subject: "events.order" }, "tenant-a"),
    ).rejects.toThrow("nats down");
  });

  it("prefers JetStream publish so Nats-Msg-Id is honoured server-side", async () => {
    await executeServiceBusCall(
      {
        subject: "events.order.created",
        payload: { id: "x1" },
        headers: { "x-trace": "abc" },
      },
      "tenant-b",
    );

    expect(mockJsPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).not.toHaveBeenCalled();
    const [subject, payload, opts] = mockJsPublish.mock.calls[0];
    expect(subject).toBe("events.order.created");
    expect(new TextDecoder().decode(payload as Uint8Array)).toBe(
      JSON.stringify({ id: "x1" }),
    );
    /**
     * Both header and `msgID` option MUST be set — the JetStream
     * server honours either, but belt-and-braces guarantees dedup
     * even if a client lib version drops one.
     */
    expect((opts as { msgID?: string })?.msgID).toBeDefined();
    expect(headerStore.get("Nats-Msg-Id")).toBe(
      (opts as { msgID?: string }).msgID,
    );
  });

  it("falls back to core-NATS publish when the subject has no bound stream", async () => {
    mockJsPublish.mockRejectedValueOnce(
      new Error("no stream matches subject"),
    );

    await executeServiceBusCall({ subject: "ad-hoc.fanout" }, "tenant-c");

    expect(mockJsPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("propagates unknown JetStream errors instead of silently downgrading", async () => {
    mockJsPublish.mockRejectedValueOnce(new Error("disk write failed"));

    await expect(
      executeServiceBusCall({ subject: "events.fail" }, "t1"),
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
      "tenant-r",
    );
    const firstKey = headerStore.get("Nats-Msg-Id");
    headerStore.clear();
    await executeServiceBusCall(
      { subject: "events.order.created", payload: { id: "x2" } },
      "tenant-r",
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
      "tenant-r",
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
