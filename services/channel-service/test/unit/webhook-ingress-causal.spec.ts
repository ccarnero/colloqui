import { describe, it, expect } from "bun:test";
import { createChannelEnvelope } from "../../src/domain/envelope.factory";

const baseMessage = {
  messageId: "msg-1",
  from: "+1234567890",
  timestamp: "1700000000",
  type: "text" as const,
  text: "hello",
};

describe("webhook causal chain threading", () => {
  it("case 1 — happy path: canonical inherits causal fields from webhook envelope", () => {
    // Given a WebhookIngressEnvelope with id="W", correlation_id="C", transport.depth=0
    // The consumer extracts: correlationId="C", causationId="W", depth=(0)+1=1
    const envelope = createChannelEnvelope({
      tenantId: "tenant-1",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
      message: baseMessage,
      accountId: "acc-1",
      correlationId: "C",
      causationId: "W",
      depth: 1, // (0 + 1)
    });

    expect(envelope.correlation_id).toBe("C");
    expect(envelope.causation_id).toBe("W");
    expect(envelope.transport.depth).toBe(1);
  });

  it("case 2 — missing transport field: depth defaults to 1 ((undefined?.depth ?? 0) + 1)", () => {
    // Given a webhook with id="W2", correlation_id="C2", no transport field.
    // Consumer computes: depth = (webhookTransport?.depth ?? 0) + 1
    // With webhookTransport = undefined → (undefined ?? 0) + 1 = 1
    const webhookTransport: { depth: number } | undefined = undefined;
    const depth = (webhookTransport?.depth ?? 0) + 1;

    const envelope = createChannelEnvelope({
      tenantId: "tenant-1",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
      message: baseMessage,
      accountId: "acc-1",
      correlationId: "C2",
      causationId: "W2",
      depth,
    });

    expect(envelope.transport.depth).toBe(1);
  });

  it("case 3 — no causal args: factory defaults apply (causation_id=null, correlation_id=own id, depth=0)", () => {
    // Non-webhook caller omits causal fields entirely
    const envelope = createChannelEnvelope({
      tenantId: "tenant-1",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
      message: baseMessage,
      accountId: "acc-1",
      // no correlationId, causationId, depth
    });

    expect(envelope.causation_id).toBeNull();
    expect(envelope.correlation_id).toBe(envelope.id);
    expect(envelope.transport.depth).toBe(0);
  });
});
