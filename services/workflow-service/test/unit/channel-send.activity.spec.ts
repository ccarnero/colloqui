import { describe, it, expect, beforeEach, mock } from "bun:test";

const mockFlush = mock(() => Promise.resolve());
const mockPublish = mock(
  (_subject: string, _payload?: Uint8Array) => undefined,
);
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

const { executeChannelSend } = await import(
  "../../src/temporal/activities/channel-send.activity"
);

describe("executeChannelSend", () => {
  beforeEach(() => {
    mockFlush.mockClear();
    mockPublish.mockClear();
    mockHeaderSet.mockClear();
    connectMock.mockClear();
    connectMock.mockImplementation(() =>
      Promise.resolve(mockConn),
    );
  });

  it("publishes to the correct channel subject", async () => {
    const result = await executeChannelSend(
      {
        accountId: "acc-1",
        channel: "whatsapp",
        provider: "meta",
        to: "+5491100000000",
        type: "text" as const,
        text: "Hello",
      },
      "acme",
    );

    expect(result.published).toBe(true);
    expect(result.subject).toBe(
      "evt.acme.messaging.whatsapp.meta.send.v1",
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);

    const [subject, payload] = mockPublish.mock.calls[0];
    expect(subject).toBe(
      "evt.acme.messaging.whatsapp.meta.send.v1",
    );
    expect(payload).toBeDefined();

    const envelope = JSON.parse(
      new TextDecoder().decode(payload as Uint8Array),
    );
    expect(envelope.tenantId).toBe("acme");
    expect(envelope.kind).toBe("send");
    expect(envelope.data.to).toBe("+5491100000000");
    expect(envelope.data.type).toBe("text");
    expect(envelope.data.text).toBe("Hello");
    expect(envelope.data.accountId).toBe("acc-1");
  });

  it("publishes telegram messages correctly", async () => {
    const result = await executeChannelSend(
      {
        accountId: "tg-bot-1",
        channel: "telegram",
        provider: "telegram",
        to: "123456789",
        type: "text" as const,
        text: "Hi from Telegram",
      },
      "tenant-x",
    );

    expect(result.subject).toBe(
      "evt.tenant-x.messaging.telegram.telegram.send.v1",
    );
  });

  it("sets tenant and idempotency headers", async () => {
    await executeChannelSend(
      {
        accountId: "acc-1",
        channel: "whatsapp",
        provider: "meta",
        to: "+1234",
        type: "text" as const,
      },
      "tenant-h",
    );

    const tenantCall = mockHeaderSet.mock.calls.find(
      ([k]) => k === "x-yoizen-tenant",
    );
    expect(tenantCall).toBeDefined();
    expect(tenantCall?.[1]).toBe("tenant-h");

    const idempotencyCall = mockHeaderSet.mock.calls.find(
      ([k]) => k === "Nats-Msg-Id",
    );
    expect(idempotencyCall).toBeDefined();
  });

  it("rejects when NATS connect fails", async () => {
    /* Simulate closed connection so getConnection retries */
    Object.defineProperty(mockConn, "isClosed", {
      value: () => true,
      configurable: true,
    });
    connectMock.mockRejectedValueOnce(
      new Error("nats down"),
    );

    await expect(
      executeChannelSend(
        {
          accountId: "acc-1",
          channel: "whatsapp",
          provider: "meta",
          to: "+1",
          type: "text" as const,
        },
        "t1",
      ),
    ).rejects.toThrow("nats down");

    Object.defineProperty(mockConn, "isClosed", {
      value: () => false,
      configurable: true,
    });
  });

  it("flushes after publish", async () => {
    await executeChannelSend(
      {
        accountId: "acc-1",
        channel: "whatsapp",
        provider: "meta",
        to: "+1",
        type: "text" as const,
      },
      "t1",
    );

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});
