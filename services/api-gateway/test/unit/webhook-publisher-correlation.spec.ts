import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { JetStreamClient, JetStreamManager } from "nats";
import { WebhookIngressPublisherService } from "../../src/modules/channels/webhook-ingress-publisher.service";
import type { IYoizenRequest } from "../../src/types/yoizen-request";

describe("WebhookIngressPublisherService — correlation stamping", () => {
  const publish = mock(() => Promise.resolve({ seq: 1 }));
  const add = mock(() => Promise.resolve({}));

  const js = { publish } as unknown as JetStreamClient;
  const jsm = { streams: { add } } as unknown as JetStreamManager;

  beforeEach(() => {
    publish.mockClear();
    add.mockClear();
  });

  it("stamps __correlationId, __causationId, __depth on the request after minting", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);
    const request = {} as IYoizenRequest;

    const id = await service.publishWebhook({
      tenantId: "t1",
      channel: "telegram",
      rawBody: Buffer.from(JSON.stringify({ entry: [] })),
      parsedBody: { entry: [] },
      headers: {},
      request,
    });

    expect(request.__correlationId).toBe(id);
    expect(request.__causationId).toBeNull();
    expect(request.__depth).toBe(0);
  });

  it("does not throw when request is omitted", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);

    // No request passed — should complete without error
    const id = await service.publishWebhook({
      tenantId: "t2",
      channel: "telegram",
      rawBody: Buffer.from(JSON.stringify({ update_id: 1 })),
      parsedBody: { update_id: 1 },
      headers: {},
    });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("correlationId stamped on request equals the returned id (= envelope id)", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);
    const request = {} as IYoizenRequest;

    const id = await service.publishWebhook({
      tenantId: "t3",
      channel: "telegram",
      rawBody: Buffer.from("{}"),
      parsedBody: {},
      headers: {},
      request,
    });

    // The published envelope's correlation_id = id = request.__correlationId
    expect(request.__correlationId).toBe(id);

    // Verify the envelope itself also carries the same correlation_id
    const [, bytes] = publish.mock.calls[publish.mock.calls.length - 1] as [
      string,
      Uint8Array,
    ];
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as {
      correlation_id: string;
      id: string;
    };
    expect(envelope.id).toBe(id);
    expect(envelope.correlation_id).toBe(id);
  });
});
