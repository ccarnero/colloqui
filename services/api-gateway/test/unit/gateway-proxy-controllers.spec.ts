import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { WebhooksController } from "../../src/modules/channels/webhooks.controller";
import { ChannelsProxyService } from "../../src/modules/channels/channels-proxy.service";
import { DashboardController } from "../../src/modules/dashboard/dashboard.controller";
import { DashboardProxyService } from "../../src/modules/dashboard/dashboard-proxy.service";
import { ProxyController } from "../../src/modules/proxy/proxy.controller";
import { ProxyProxyService } from "../../src/modules/proxy/proxy-proxy.service";

describe("Gateway proxy controllers", () => {
  describe("WebhooksController", () => {
    let controller: WebhooksController;
    let proxy: ReturnType<typeof mock>;

    beforeEach(async () => {
      proxy = mock(() => Promise.resolve({ challenge: "x" }));
      const moduleRef = await Test.createTestingModule({
        controllers: [WebhooksController],
        providers: [{ provide: ChannelsProxyService, useValue: { proxy } }],
      }).compile();
      controller = moduleRef.get(WebhooksController);
    });

    it("verify forwards to channels proxy", async () => {
      await controller.verify("whatsapp", "t1", {
        "hub.mode": "subscribe",
        "hub.verify_token": "tok",
        "hub.challenge": "ch",
      } as never);
      expect(proxy).toHaveBeenCalledWith({
        method: "GET",
        path: "/webhooks/whatsapp/t1",
        tenantId: "t1",
        query: {
          "hub.mode": "subscribe",
          "hub.verify_token": "tok",
          "hub.challenge": "ch",
        },
      });
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
