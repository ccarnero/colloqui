import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { NatsConnection } from "nats";
import { SendCommandConsumerService } from "../../src/modules/egress/send-command-consumer.service";
import type { EgressService } from "../../src/modules/egress/egress.service";

describe("SendCommandConsumerService", () => {
  let service: SendCommandConsumerService;
  const send = mock(() =>
    Promise.resolve({
      success: true,
      providerMessageId: "pm-1",
      timestamp: new Date().toISOString(),
    }),
  );
  const egress = { send } as unknown as EgressService;

  const nc = {
    subscribe: mock(() => ({ unsubscribe: mock(() => {}) })),
  } as unknown as NatsConnection;

  beforeEach(() => {
    send.mockClear();
    service = new SendCommandConsumerService(nc, egress);
  });

  function buildMessage(
    subject: string,
    data: Record<string, unknown>,
  ): { subject: string; data: Uint8Array } {
    return {
      subject,
      data: new TextEncoder().encode(JSON.stringify(data)),
    };
  }

  const CANONICAL_SEND_SUBJECT =
    "evt.acme.channel-service.messaging.whatsapp.meta.send.v1";

  const baseEnvelope = {
    id: "cmd-1",
    specversion: "1.0",
    type: "io.yoizen.messaging.whatsapp.meta.send.v1",
    source: "//workflow-service/channel-send",
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    subject: CANONICAL_SEND_SUBJECT,
    data: {
      accountId: "acc-1",
      to: "+5491100000000",
      type: "text",
      text: "Hello from workflow",
    },
    tenantId: "acme",
    tenant: "acme",
    channel: "whatsapp",
    provider: "meta",
    kind: "send",
    idempotencyKey: "sha256:acme_whatsapp_send",
    correlation_id: "corr-1",
    transport: { method: "stream", protocol: "internal", depth: 2 },
  };

  it("calls EgressService.send with correct arguments and causal context", async () => {
    await (
      service as unknown as {
        handleMessage: (m: unknown) => Promise<void>;
      }
    ).handleMessage(buildMessage(CANONICAL_SEND_SUBJECT, baseEnvelope));

    expect(send).toHaveBeenCalledTimes(1);
    const [tenantId, accountId, outbound, causal] = send.mock.calls[0];
    expect(tenantId).toBe("acme");
    expect(accountId).toBe("acc-1");
    expect(outbound).toMatchObject({
      to: "+5491100000000",
      type: "text",
      text: "Hello from workflow",
    });
    expect(causal).toEqual({
      causationId: "cmd-1",
      correlationId: "corr-1",
      incomingDepth: 2,
    });
  });

  it("does nothing when subject cannot be parsed", async () => {
    await (
      service as unknown as {
        handleMessage: (m: unknown) => Promise<void>;
      }
    ).handleMessage(buildMessage("bad.subject", baseEnvelope));

    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing when accountId is missing", async () => {
    const noAccount = {
      ...baseEnvelope,
      accountid: undefined,
      data: { ...baseEnvelope.data, accountId: undefined },
    };

    await (
      service as unknown as {
        handleMessage: (m: unknown) => Promise<void>;
      }
    ).handleMessage(buildMessage(CANONICAL_SEND_SUBJECT, noAccount));

    expect(send).not.toHaveBeenCalled();
  });

  it("handles template message type", async () => {
    const templateEnvelope = {
      ...baseEnvelope,
      data: {
        accountId: "acc-1",
        to: "+5491100000000",
        type: "template",
        templateName: "welcome",
        templateLanguage: "en_US",
      },
    };

    await (
      service as unknown as {
        handleMessage: (m: unknown) => Promise<void>;
      }
    ).handleMessage(buildMessage(CANONICAL_SEND_SUBJECT, templateEnvelope));

    expect(send).toHaveBeenCalledTimes(1);
    const [, , outbound] = send.mock.calls[0];
    expect(outbound).toMatchObject({
      type: "template",
      templateName: "welcome",
      templateLanguage: "en_US",
    });
  });

  it("does nothing when tenantId is missing", async () => {
    const noTenant = { ...baseEnvelope, tenantId: "", tenant: "" };

    await (
      service as unknown as {
        handleMessage: (m: unknown) => Promise<void>;
      }
    ).handleMessage(buildMessage(CANONICAL_SEND_SUBJECT, noTenant));

    expect(send).not.toHaveBeenCalled();
  });
});
