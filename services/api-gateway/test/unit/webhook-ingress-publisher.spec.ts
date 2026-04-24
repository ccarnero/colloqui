import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { JetStreamClient, JetStreamManager } from "nats";
import { TENANT_HEADER } from "@yoizen/shared";
import { WebhookIngressPublisherService } from "../../src/modules/channels/webhook-ingress-publisher.service";

describe("WebhookIngressPublisherService", () => {
  const publish = mock(() => Promise.resolve({ seq: 1 }));
  const info = mock(() => Promise.resolve({}));
  const add = mock(() => Promise.resolve({}));

  const js = { publish } as unknown as JetStreamClient;
  const jsm = {
    streams: { info, add },
  } as unknown as JetStreamManager;

  beforeEach(() => {
    publish.mockClear();
    info.mockClear();
    add.mockClear();
  });

  it("publishes canonical webhook ingress envelope with filtered headers", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);
    const rawBody = Buffer.from(
      JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      "utf8",
    );

    await service.publishWebhook({
      tenantId: "tenant-a",
      channel: "whatsapp",
      rawBody,
      parsedBody: { object: "whatsapp_business_account", entry: [] },
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=test",
        authorization: "secret",
      },
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [subject, bytes, options] = publish.mock.calls[0];
    expect(subject).toBe(
      "evt.tenant-a.api-gateway.messaging.whatsapp.webhook.webhook_received.v1",
    );

    const envelope = JSON.parse(new TextDecoder().decode(bytes));
    expect(envelope.tenant).toBe("tenant-a");
    expect(envelope.kind).toBe("webhook_received");
    // `accountid` MUST be absent — the account is unresolved at this
    // stage and using a placeholder would corrupt per-account usage
    // aggregations downstream (billing).
    expect("accountid" in envelope).toBe(false);
    expect(envelope.data.raw_body_b64).toBe(rawBody.toString("base64"));
    expect(envelope.data.headers).toEqual({
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=test",
    });
    expect(options.headers.get(TENANT_HEADER)).toBe("tenant-a");
    expect(options.headers.get("Nats-Msg-Id")).toBe(envelope.idempotencykey);
  });

  it("ensures tenant stream once per tenant (Set cache O(1) hit)", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);
    const tenantId = `tenant-${Date.now()}`;

    await service.publishWebhook({
      tenantId,
      channel: "telegram",
      rawBody: Buffer.from("{\"update_id\":1}"),
      parsedBody: { update_id: 1 },
      headers: {},
    });
    await service.publishWebhook({
      tenantId,
      channel: "telegram",
      rawBody: Buffer.from("{\"update_id\":2}"),
      parsedBody: { update_id: 2 },
      headers: {},
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(0);
  });
});
