import { describe, it, expect } from "bun:test";
import { createChannelEnvelope } from "../../src/domain/envelope.factory";

describe("createChannelEnvelope", () => {
  it("builds envelope with idempotency and subject", () => {
    const env = createChannelEnvelope({
      tenantId: "tenant-a",
      channel: "whatsapp",
      provider: "meta",
      kind: "received",
      message: {
        messageId: "m1",
        from: "+1",
        timestamp: "123",
        type: "text",
        text: "hi",
        raw: {},
      },
      accountId: "acc-1",
    });
    expect(env.tenant).toBe("tenant-a");
    expect(env.channel).toBe("whatsapp");
    expect(env.kind).toBe("received");
    expect(env.producer).toBe("channel-service");
    expect(env.domain).toBe("messaging");
    expect(env.accountid).toBe("acc-1");

    expect(env.idempotencykey).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(env.data.payload_inline).toBe(true);
    const payload = env.data.payload as Record<string, unknown>;
    expect(payload.messageId).toBe("m1");
    expect(payload.accountId).toBe("acc-1");

    expect(env.transport.depth).toBe(0);
  });

  it("produces deterministic idempotencyKey for identical raw payloads", () => {
    const base = {
      tenantId: "t1",
      channel: "whatsapp" as const,
      provider: "meta" as const,
      kind: "received" as const,
      accountId: "acc-1",
      message: {
        messageId: "m1",
        from: "+1",
        timestamp: "123",
        type: "text" as const,
        text: "hello",
      },
    };
    const a = createChannelEnvelope(base);
    const b = createChannelEnvelope(base);
    expect(a.idempotencykey).toBe(b.idempotencykey);
  });
});
