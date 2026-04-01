import { describe, it, expect, beforeEach, mock } from "bun:test";

const mockFlush = mock(() => Promise.resolve());
const mockPublish = mock((_subject: string, _payload?: Uint8Array) => undefined);
const mockHeaderSet = mock(
  (_key: string, _value: string) => undefined,
);

const mockConn = {
  isClosed: () => false,
  publish: mockPublish,
  flush: mockFlush,
};

const connectMock = mock(() => Promise.resolve(mockConn));

mock.module("nats", () => ({
  connect: connectMock,
  headers: () => ({
    set: mockHeaderSet,
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
    connectMock.mockClear();
    connectMock.mockImplementation(() => Promise.resolve(mockConn));
  });

  it("rejects when NATS connect fails", async () => {
    connectMock.mockRejectedValueOnce(new Error("nats down"));

    await expect(
      executeServiceBusCall({ subject: "events.order" }, "tenant-a"),
    ).rejects.toThrow("nats down");
  });

  it("publishes JSON payload with tenant and custom headers", async () => {
    await executeServiceBusCall(
      {
        subject: "events.order.created",
        payload: { id: "x1" },
        headers: { "x-trace": "abc" },
      },
      "tenant-b",
    );

    expect(connectMock).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [subject, payload] = mockPublish.mock.calls[0];
    expect(subject).toBe("events.order.created");
    expect(payload).toBeDefined();
    expect(new TextDecoder().decode(payload as Uint8Array)).toBe(
      JSON.stringify({ id: "x1" }),
    );
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockHeaderSet.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("publishes without payload when omitted", async () => {
    await executeServiceBusCall({ subject: "ping" }, "tenant-c");

    const [, payload] = mockPublish.mock.calls[0];
    expect(payload).toBeUndefined();
  });

  it("propagates flush errors", async () => {
    mockFlush.mockRejectedValueOnce(new Error("flush failed"));

    await expect(
      executeServiceBusCall({ subject: "events.fail" }, "t1"),
    ).rejects.toThrow("flush failed");
  });
});
