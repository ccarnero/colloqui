import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ensureTenantIngressStream } from "@yoizen/database";
import { TENANT_HEADER } from "@yoizen/shared";
import type { JetStreamClient, JetStreamManager } from "nats";
import { gatewayConfig } from "../../src/config";
import { WebhookIngressPublisherService } from "../../src/modules/channels/webhook-ingress-publisher.service";
import { WebhookPublishUnavailableError } from "../../src/modules/channels/webhook-publish-unavailable.error";

/**
 * `ensureTenantIngressStream` (mocked via `preload-database-mock.ts`) owns
 * the per-tenant "ensure once" caching in `@yoizen/database` now — see
 * `packages/database/test/unit/nats-provider.spec.ts` for that contract.
 * This suite only verifies `WebhookIngressPublisherService` delegates to it
 * with the right arguments on every publish.
 */
const ensureTenantIngressStreamMock =
  ensureTenantIngressStream as unknown as ReturnType<typeof mock>;

describe("WebhookIngressPublisherService", () => {
  const publish = mock(() => Promise.resolve({ seq: 1 }));
  const add = mock(() => Promise.resolve({}));

  const js = { publish } as unknown as JetStreamClient;
  const jsm = {
    streams: { add },
  } as unknown as JetStreamManager;

  beforeEach(() => {
    publish.mockClear();
    add.mockClear();
    ensureTenantIngressStreamMock.mockClear();
  });

  it("publishes canonical webhook ingress envelope with filtered headers", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);
    const rawBody = Buffer.from(
      JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
      "utf8"
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
      "evt.tenant-a.api-gateway.messaging.whatsapp.webhook.webhook_received.v1"
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

  it("delegates tenant stream ensure to @yoizen/database on every publish", async () => {
    const service = new WebhookIngressPublisherService(js, jsm);
    const tenantId = `tenant-${Date.now()}`;

    await service.publishWebhook({
      tenantId,
      channel: "telegram",
      rawBody: Buffer.from('{"update_id":1}'),
      parsedBody: { update_id: 1 },
      headers: {},
    });
    await service.publishWebhook({
      tenantId,
      channel: "telegram",
      rawBody: Buffer.from('{"update_id":2}'),
      parsedBody: { update_id: 2 },
      headers: {},
    });

    // The service no longer owns the per-tenant "ensure once" cache itself
    // (see WebhookIngressPublisherService — it calls ensureTenantIngressStream
    // unconditionally); the O(1) Set-cache short-circuit now lives inside
    // ensureTenantIngressStream in @yoizen/database, so it is called once
    // per publish here, always with the same (jsm, tenantId) pair.
    expect(ensureTenantIngressStreamMock).toHaveBeenCalledTimes(2);
    expect(ensureTenantIngressStreamMock).toHaveBeenNthCalledWith(
      1,
      jsm,
      tenantId
    );
    expect(ensureTenantIngressStreamMock).toHaveBeenNthCalledWith(
      2,
      jsm,
      tenantId
    );
    expect(add).not.toHaveBeenCalled();
  });

  /**
   * 2026-05-22 post-mortem regression suite
   * (`post-mortem/POST-MORTEM.md` §P1.2). Before the fix, an
   * indefinitely-pending `js.publish` surfaced as an opaque 500 to
   * providers (118 `NatsError: TIMEOUT` in 2 seconds). Now it MUST
   * surface as `WebhookPublishUnavailableError` (HTTP 503 via the
   * global exception filter).
   */
  describe("publish timeout (post-mortem §P1.2)", () => {
    const stalledPublish = mock(() => new Promise(() => {}));
    const stalledJs = { publish: stalledPublish } as unknown as JetStreamClient;

    beforeEach(() => {
      stalledPublish.mockClear();
    });

    it("throws WebhookPublishUnavailableError when js.publish never resolves", async () => {
      // Override the timeout to keep the test fast (50ms).
      const originalTimeout = gatewayConfig.webhook.publishTimeoutMs;
      (gatewayConfig.webhook as { publishTimeoutMs: number }).publishTimeoutMs =
        50;
      try {
        const service = new WebhookIngressPublisherService(stalledJs, jsm);
        const promise = service.publishWebhook({
          tenantId: "tenant-stall",
          channel: "whatsapp",
          rawBody: Buffer.from("{}"),
          parsedBody: {},
          headers: {},
        });

        await expect(promise).rejects.toBeInstanceOf(
          WebhookPublishUnavailableError
        );
      } finally {
        (
          gatewayConfig.webhook as { publishTimeoutMs: number }
        ).publishTimeoutMs = originalTimeout;
      }
    });

    it("releases the in-flight slot after a timeout failure", async () => {
      const originalTimeout = gatewayConfig.webhook.publishTimeoutMs;
      (gatewayConfig.webhook as { publishTimeoutMs: number }).publishTimeoutMs =
        25;
      try {
        const service = new WebhookIngressPublisherService(stalledJs, jsm);
        await expect(
          service.publishWebhook({
            tenantId: "tenant-stall-2",
            channel: "whatsapp",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
        ).rejects.toBeInstanceOf(WebhookPublishUnavailableError);

        // Second call must NOT trip the in-flight cap (slot released).
        await expect(
          service.publishWebhook({
            tenantId: "tenant-stall-2",
            channel: "whatsapp",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
        ).rejects.toBeInstanceOf(WebhookPublishUnavailableError);
      } finally {
        (
          gatewayConfig.webhook as { publishTimeoutMs: number }
        ).publishTimeoutMs = originalTimeout;
      }
    });
  });

  describe("in-flight cap (post-mortem §P1.2)", () => {
    /**
     * A publish promise that never resolves so we can pile up inflight
     * calls without races. The first N calls reserve the cap; the
     * N+1-th must bounce immediately with `WebhookPublishUnavailableError`.
     */
    const blockedPublish = mock(() => new Promise(() => {}));
    const blockedJs = { publish: blockedPublish } as unknown as JetStreamClient;

    it("rejects with WebhookPublishUnavailableError once the per-pod cap is exhausted", async () => {
      const original = gatewayConfig.webhook.publishInflightCap;
      (
        gatewayConfig.webhook as { publishInflightCap: number }
      ).publishInflightCap = 2;
      try {
        const service = new WebhookIngressPublisherService(blockedJs, jsm);

        // Saturate the cap with two never-resolving publishes.
        void service
          .publishWebhook({
            tenantId: "tenant-cap",
            channel: "whatsapp",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
          .catch(() => undefined);
        void service
          .publishWebhook({
            tenantId: "tenant-cap",
            channel: "whatsapp",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
          .catch(() => undefined);

        // Yield once so the in-flight counter is observably 2.
        await new Promise((r) => setImmediate(r));

        await expect(
          service.publishWebhook({
            tenantId: "tenant-cap",
            channel: "whatsapp",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
        ).rejects.toBeInstanceOf(WebhookPublishUnavailableError);
      } finally {
        (
          gatewayConfig.webhook as { publishInflightCap: number }
        ).publishInflightCap = original;
      }
    });
  });
});
