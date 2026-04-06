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
    expect(env.tenantId).toBe("tenant-a");
    expect(env.channel).toBe("whatsapp");
    expect(env.kind).toBe("received");
    expect(env.idempotencyKey).toBe("tenant-a:whatsapp:m1");
    expect(env.data.messageId).toBe("m1");
    expect(env.data.accountId).toBe("acc-1");
  });
});
