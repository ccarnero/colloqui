import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { JetStreamClient, JetStreamManager } from "nats";
import { WebhookIngressConsumerService } from "../../src/modules/webhooks/webhook-ingress-consumer.service";
import type { WebhookIngressService } from "../../src/modules/webhooks/webhook-ingress.service";

describe("WebhookIngressConsumerService", () => {
  const processEnvelope = mock(() => Promise.resolve({ status: "accepted" }));
  const webhookIngress = {
    processEnvelope,
  } as unknown as WebhookIngressService;
  const jsm = {} as unknown as JetStreamManager;
  const js = {} as unknown as JetStreamClient;

  beforeEach(() => {
    processEnvelope.mockClear();
  });

  function buildEnvelope(tenant = "t1"): Record<string, unknown> {
    return {
      specversion: "1.0",
      id: "evt-1",
      source: "api-gateway/webhooks",
      type: "io.yoizen.messaging.webhook.received.v1",
      resource: `tenant/${tenant}/channel/telegram/provider/webhook`,
      time: new Date().toISOString(),
      traceid: "trace-1",
      causation_id: null,
      correlation_id: "corr-1",
      tenant,
      producer: "api-gateway",
      domain: "messaging",
      channel: "telegram",
      provider: "webhook",
      kind: "webhook_received",
      idempotencykey: "sha256:test",
      transport: { method: "webhook", protocol: "https", depth: 0 },
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 2,
        payload_checksum: "sha256:test",
        payload: { object: "telegram_update" },
        raw_body_b64: Buffer.from("{\"object\":\"ok\"}", "utf8").toString("base64"),
        headers: {
          "x-telegram-bot-api-secret-token": "secret-1",
        },
      },
    };
  }

  it("forwards valid webhook envelopes to WebhookIngressService", async () => {
    const service = new WebhookIngressConsumerService(jsm, js, webhookIngress);
    const msg = {
      subject: "evt.t1.api-gateway.messaging.telegram.webhook.webhook_received.v1",
      data: new TextEncoder().encode(JSON.stringify(buildEnvelope("t1"))),
    };

    await (
      service as unknown as {
        handleJsMessage: (message: unknown) => Promise<void>;
      }
    ).handleJsMessage(msg);

    expect(processEnvelope).toHaveBeenCalledTimes(1);
    const [channel, tenantId, rawBody, headers, payload] =
      processEnvelope.mock.calls[0];
    expect(channel).toBe("telegram");
    expect(tenantId).toBe("t1");
    expect(Buffer.isBuffer(rawBody)).toBeTrue();
    expect((rawBody as Buffer).toString("utf8")).toBe("{\"object\":\"ok\"}");
    expect(headers).toEqual({ "x-telegram-bot-api-secret-token": "secret-1" });
    expect(payload).toEqual({ object: "telegram_update" });
  });

  it("forwards data.instance as the 7th argument to processEnvelope", async () => {
    const service = new WebhookIngressConsumerService(jsm, js, webhookIngress);
    const envelopeWithInstance = {
      ...buildEnvelope("t1"),
      data: {
        ...buildEnvelope("t1").data,
        instance: "my-instance",
      },
    };
    const msg = {
      subject: "evt.t1.api-gateway.messaging.telegram.webhook.webhook_received.v1",
      data: new TextEncoder().encode(JSON.stringify(envelopeWithInstance)),
    };

    await (
      service as unknown as {
        handleJsMessage: (message: unknown) => Promise<void>;
      }
    ).handleJsMessage(msg);

    expect(processEnvelope).toHaveBeenCalledTimes(1);
    const args = processEnvelope.mock.calls[0];
    // 7th argument (index 6) must be the instance string
    expect(args[6]).toBe("my-instance");
  });

  it("ignores non-matching subjects", async () => {
    const service = new WebhookIngressConsumerService(jsm, js, webhookIngress);
    const msg = {
      subject: "evt.t1.channel-service.messaging.telegram.telegram.received.v1",
      data: new TextEncoder().encode(JSON.stringify(buildEnvelope("t1"))),
    };

    await (
      service as unknown as {
        handleJsMessage: (message: unknown) => Promise<void>;
      }
    ).handleJsMessage(msg);

    expect(processEnvelope).not.toHaveBeenCalled();
  });
});
