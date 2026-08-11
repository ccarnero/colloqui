import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { WebhookIngressPublisherService } from "../../src/modules/channels/webhook-ingress-publisher.service";
import { WebhooksController } from "../../src/modules/channels/webhooks.controller";
import { DashboardController } from "../../src/modules/dashboard/dashboard.controller";
import { DashboardProxyService } from "../../src/modules/dashboard/dashboard-proxy.service";
import { ProxyController } from "../../src/modules/proxy/proxy.controller";
import { ProxyProxyService } from "../../src/modules/proxy/proxy-proxy.service";

describe("Gateway proxy controllers", () => {
  describe("WebhooksController", () => {
    let controller: WebhooksController;
    let publishWebhook: ReturnType<typeof mock>;

    beforeEach(async () => {
      publishWebhook = mock(() => Promise.resolve());
      const moduleRef = await Test.createTestingModule({
        controllers: [WebhooksController],
        providers: [
          {
            provide: WebhookIngressPublisherService,
            useValue: { publishWebhook },
          },
        ],
      }).compile();
      controller = moduleRef.get(WebhooksController);
    });

    it("receive forwards the raw body to the ingress publisher", async () => {
      const rawBody = Buffer.from('{"update_id":1}', "utf8");
      const request = {
        rawBody,
        headers: { "x-telegram-bot-api-secret-token": "tok" },
        body: { update_id: 1 },
      };

      const out = await controller.receive("telegram", "t1", request as never);

      expect(out).toEqual({ status: "accepted" });
      expect(publishWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t1",
          channel: "telegram",
          rawBody,
        })
      );
    });
  });

  describe("DashboardController", () => {
    it("getStats delegates to DashboardProxyService", async () => {
      const getStats = mock(() => Promise.resolve({} as never));
      const moduleRef = await Test.createTestingModule({
        controllers: [DashboardController],
        providers: [{ provide: DashboardProxyService, useValue: { getStats } }],
      }).compile();
      const controller = moduleRef.get(DashboardController);
      await controller.getStats({ tenantId: "t1" } as never);
      expect(getStats).toHaveBeenCalledWith("t1");
    });
  });

  describe("ProxyController", () => {
    it("handleRoot forwards to ProxyProxyService", async () => {
      const forward = mock(() => Promise.resolve());
      const moduleRef = await Test.createTestingModule({
        controllers: [ProxyController],
        providers: [{ provide: ProxyProxyService, useValue: { forward } }],
      }).compile();
      const controller = moduleRef.get(ProxyController);
      const req = {} as never;
      const reply = {} as never;
      await controller.handleRoot(req, reply);
      expect(forward).toHaveBeenCalledWith(req, reply);
    });
  });
});
