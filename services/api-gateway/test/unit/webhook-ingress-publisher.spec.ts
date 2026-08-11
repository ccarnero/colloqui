import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ensureTenantIngressStream } from "@yoizen/database";
import type { Channel } from "@yoizen/shared";
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
      JSON.stringify({ update_id: 421, message: { text: "hola" } }),
      "utf8"
    );

    await service.publishWebhook({
      tenantId: "tenant-a",
      channel: "telegram",
      rawBody,
      parsedBody: { update_id: 421, message: { text: "hola" } },
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "tok_test",
        authorization: "secret",
      },
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [subject, bytes, options] = publish.mock.calls[0];
    expect(subject).toBe(
      "evt.tenant-a.api-gateway.messaging.telegram.webhook.webhook_received.v1"
    );

    const envelope = JSON.parse(new TextDecoder().decode(bytes));
    expect(envelope.tenant).toBe("tenant-a");
    expect(envelope.kind).toBe("webhook_received");
    // envelope-drift T05: `type` follows envelope.md §2.1 and carries the
    // channel, instead of the old channel-less
    // `io.yoizen.messaging.webhook.received.v1`.
    expect(envelope.type).toBe(
      "io.yoizen.messaging.telegram.webhook.webhook_received.v1"
    );
    // `accountid` MUST be absent — the account is unresolved at this
    // stage and using a placeholder would corrupt per-account usage
    // aggregations downstream (billing).
    expect("accountid" in envelope).toBe(false);
    expect(envelope.data.raw_body_b64).toBe(rawBody.toString("base64"));
    // Allowlist applied (`authorization` dropped), verification secret kept:
    // stage 2 needs it to authenticate and strips it afterwards.
    expect(envelope.data.headers).toEqual({
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "tok_test",
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
          channel: "telegram",
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
            channel: "telegram",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
        ).rejects.toBeInstanceOf(WebhookPublishUnavailableError);

        // Second call must NOT trip the in-flight cap (slot released).
        await expect(
          service.publishWebhook({
            tenantId: "tenant-stall-2",
            channel: "telegram",
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
            channel: "telegram",
            rawBody: Buffer.from("{}"),
            parsedBody: {},
            headers: {},
          })
          .catch(() => undefined);
        void service
          .publishWebhook({
            tenantId: "tenant-cap",
            channel: "telegram",
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
            channel: "telegram",
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

  // =========================================================================
  // envelope-drift T05 — stage-1 `type` obeys the prescriptive format
  // (SPEC decision 2). The old code emitted the SAME channel-less literal
  // `io.yoizen.messaging.webhook.received.v1` for every channel, so `type`
  // could not be used to recover the channel or to tell a stage-1 receipt
  // apart from a stage-2 `received` (DRIFT.md row 1).
  // =========================================================================
  describe("stage-1 envelope type", () => {
    async function publishOn(
      channel: Channel
    ): Promise<Record<string, unknown>> {
      publish.mockClear();
      const service = new WebhookIngressPublisherService(js, jsm);
      await service.publishWebhook({
        tenantId: "tenant-a",
        channel,
        rawBody: Buffer.from('{"ping":1}'),
        parsedBody: { ping: 1 },
        headers: {},
      });
      const [, bytes] = publish.mock.calls[0];
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    it("emits a per-channel type for every channel stage-1 serves", async () => {
      // Every surviving channel — the Meta family (`whatsapp`/`instagram`)
      // left the `Channel` union with the Meta channel decommission.
      const channels: readonly Channel[] = ["telegram", "http", "e2e-tests"];
      for (const channel of channels) {
        const envelope = await publishOn(channel);
        expect(envelope.type).toBe(
          `io.yoizen.messaging.${channel}.webhook.webhook_received.v1`
        );
        expect(envelope.type).not.toBe(
          "io.yoizen.messaging.webhook.received.v1"
        );
      }
    });

    it("keeps `type` consistent with `kind`, `channel` and the subject", async () => {
      publish.mockClear();
      const service = new WebhookIngressPublisherService(js, jsm);
      await service.publishWebhook({
        tenantId: "tenant-a",
        channel: "telegram",
        rawBody: Buffer.from('{"update_id":7}'),
        parsedBody: { update_id: 7 },
        headers: {},
      });

      const [subject, bytes] = publish.mock.calls[0];
      const envelope = JSON.parse(new TextDecoder().decode(bytes));

      // The subject was always per-channel; `type` now agrees with it.
      expect(
        String(subject).endsWith(
          String(envelope.type).split(".").slice(-4).join(".")
        )
      ).toBe(true);
      expect(String(envelope.type).split(".")[3]).toBe(envelope.channel);
      expect(String(envelope.type).split(".")[5]).toBe(envelope.kind);
    });

    it("does not change the published subject (wire routing untouched)", async () => {
      publish.mockClear();
      const service = new WebhookIngressPublisherService(js, jsm);
      await service.publishWebhook({
        tenantId: "tenant-a",
        channel: "telegram",
        rawBody: Buffer.from('{"update_id":8}'),
        parsedBody: { update_id: 8 },
        headers: {},
      });
      const [subject] = publish.mock.calls[0];
      expect(subject).toBe(
        "evt.tenant-a.api-gateway.messaging.telegram.webhook.webhook_received.v1"
      );
    });
  });
});
