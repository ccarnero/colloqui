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
      "evt.acme.channel-service.messaging.whatsapp.meta.send.v1",
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);

    const [subject, payload] = mockPublish.mock.calls[0];
    expect(subject).toBe(
      "evt.acme.channel-service.messaging.whatsapp.meta.send.v1",
    );
    expect(payload).toBeDefined();

    const envelope = JSON.parse(
      new TextDecoder().decode(payload as Uint8Array),
    );
    expect(envelope.tenant).toBe("acme");
    expect(envelope.kind).toBe("send");
    const payloadData = envelope.data.payload ?? envelope.data;
    expect(payloadData.to).toBe("+5491100000000");
    expect(payloadData.type).toBe("text");
    expect(payloadData.text).toBe("Hello");
    expect(payloadData.accountId).toBe("acc-1");
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
      "evt.tenant-x.channel-service.messaging.telegram.telegram.send.v1",
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

  it("propagates causal chain (causation_id, correlation_id, depth) when provided", async () => {
    await executeChannelSend(
      {
        accountId: "acc-1",
        channel: "telegram",
        provider: "telegram",
        to: "5621931457",
        type: "text" as const,
        text: "outbound",
      },
      "acme",
      {
        causation_id: "31a5659a-ac2c-46f7-a07e-09146cd66097",
        correlation_id: "31a5659a-ac2c-46f7-a07e-09146cd66097",
        depth: 0,
      },
    );

    const [, payload] = mockPublish.mock.calls[0];
    const envelope = JSON.parse(
      new TextDecoder().decode(payload as Uint8Array),
    );
    expect(envelope.causation_id).toBe(
      "31a5659a-ac2c-46f7-a07e-09146cd66097",
    );
    expect(envelope.correlation_id).toBe(
      "31a5659a-ac2c-46f7-a07e-09146cd66097",
    );
    expect(envelope.transport.depth).toBe(1);

    const causationHeader = mockHeaderSet.mock.calls.find(
      ([k]) => k === "X-Causation-Id",
    );
    expect(causationHeader?.[1]).toBe(
      "31a5659a-ac2c-46f7-a07e-09146cd66097",
    );
    const correlationHeader = mockHeaderSet.mock.calls.find(
      ([k]) => k === "X-Correlation-Id",
    );
    expect(correlationHeader?.[1]).toBe(
      "31a5659a-ac2c-46f7-a07e-09146cd66097",
    );
  });

  it("falls back to causal root when no causal context is provided", async () => {
    await executeChannelSend(
      {
        accountId: "acc-1",
        channel: "whatsapp",
        provider: "meta",
        to: "+1",
        type: "text" as const,
      },
      "acme",
    );

    const [, payload] = mockPublish.mock.calls[0];
    const envelope = JSON.parse(
      new TextDecoder().decode(payload as Uint8Array),
    );
    expect(envelope.causation_id).toBeNull();
    /* correlation_id falls back to the envelope's own id (root). */
    expect(envelope.correlation_id).toBe(envelope.id);
    expect(envelope.transport.depth).toBe(1);
  });

  it("increments depth from the incoming envelope depth", async () => {
    await executeChannelSend(
      {
        accountId: "acc-1",
        channel: "whatsapp",
        provider: "meta",
        to: "+1",
        type: "text" as const,
      },
      "acme",
      {
        causation_id: "parent-evt",
        correlation_id: "conv-123",
        depth: 3,
      },
    );

    const [, payload] = mockPublish.mock.calls[0];
    const envelope = JSON.parse(
      new TextDecoder().decode(payload as Uint8Array),
    );
    expect(envelope.transport.depth).toBe(4);
  });

  it("produces distinct idempotency keys for identical payloads across different causal chains", async () => {
    const args = {
      accountId: "acc-1",
      channel: "telegram" as const,
      provider: "telegram" as const,
      to: "5621931457",
      type: "text" as const,
      text: "cheke cheka",
    };

    await executeChannelSend(args, "acme", {
      causation_id: "trigger-evt-1",
      correlation_id: "conv-1",
      depth: 0,
    });
    await executeChannelSend(args, "acme", {
      causation_id: "trigger-evt-2",
      correlation_id: "conv-2",
      depth: 0,
    });

    const envelopes = mockPublish.mock.calls.map(([, buf]) =>
      JSON.parse(new TextDecoder().decode(buf as Uint8Array)),
    );
    expect(envelopes[0].data.payload).toEqual(envelopes[1].data.payload);
    expect(envelopes[0].data.payload_checksum).toBe(
      envelopes[1].data.payload_checksum,
    );
    expect(envelopes[0].idempotencykey).not.toBe(envelopes[1].idempotencykey);

    const msgIdCalls = mockHeaderSet.mock.calls.filter(
      ([k]) => k === "Nats-Msg-Id",
    );
    expect(msgIdCalls).toHaveLength(2);
    expect(msgIdCalls[0][1]).not.toBe(msgIdCalls[1][1]);
  });

  it("produces identical idempotency keys for the same causal chain (Temporal retries collapse)", async () => {
    const args = {
      accountId: "acc-1",
      channel: "telegram" as const,
      provider: "telegram" as const,
      to: "5621931457",
      type: "text" as const,
      text: "cheke cheka",
    };
    const causal = {
      causation_id: "trigger-evt-1",
      correlation_id: "conv-1",
      depth: 0,
    };

    await executeChannelSend(args, "acme", causal);
    await executeChannelSend(args, "acme", causal);

    const envelopes = mockPublish.mock.calls.map(([, buf]) =>
      JSON.parse(new TextDecoder().decode(buf as Uint8Array)),
    );
    expect(envelopes[0].idempotencykey).toBe(envelopes[1].idempotencykey);
  });
});
