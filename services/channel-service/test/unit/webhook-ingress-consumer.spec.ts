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
      source: "//api-gateway/webhooks",
      type: "io.yoizen.messaging.webhook.received.v1",
      resource: `tenant/${tenant}/channel/whatsapp/provider/webhook`,
      time: new Date().toISOString(),
      traceid: "trace-1",
      causation_id: null,
      correlation_id: "corr-1",
      tenant,
      producer: "api-gateway",
      domain: "messaging",
      channel: "whatsapp",
      provider: "webhook",
      accountid: tenant,
      kind: "webhook_received",
      idempotencykey: "sha256:test",
      transport: { method: "webhook", protocol: "https", depth: 0 },
      data: {
        received_at: new Date().toISOString(),
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 2,
        payload_checksum: "sha256:test",
        payload: { object: "whatsapp_business_account" },
        raw_body_b64: Buffer.from("{\"object\":\"ok\"}", "utf8").toString("base64"),
        headers: {
          "x-hub-signature-256": "sha256=abc",
        },
      },
    };
  }

  it("forwards valid webhook envelopes to WebhookIngressService", async () => {
    const service = new WebhookIngressConsumerService(jsm, js, webhookIngress);
    const msg = {
      subject: "evt.t1.api-gateway.messaging.whatsapp.webhook.webhook_received.v1",
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
    expect(channel).toBe("whatsapp");
    expect(tenantId).toBe("t1");
    expect(Buffer.isBuffer(rawBody)).toBeTrue();
    expect((rawBody as Buffer).toString("utf8")).toBe("{\"object\":\"ok\"}");
    expect(headers).toEqual({ "x-hub-signature-256": "sha256=abc" });
    expect(payload).toEqual({ object: "whatsapp_business_account" });
  });

  it("ignores non-matching subjects", async () => {
    const service = new WebhookIngressConsumerService(jsm, js, webhookIngress);
    const msg = {
      subject: "evt.t1.channel-service.messaging.whatsapp.meta.received.v1",
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
