import { beforeEach, describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import { EgressService } from "../../src/modules/egress/egress.service";
import { AutoReplyService } from "../../src/modules/auto-reply/auto-reply.service";
import type { AutoReplyRepository } from "../../src/modules/auto-reply/auto-reply.repository";

describe("Channel message flow services", () => {
  describe("IngressService", () => {
    it("publishes inbound messages", async () => {
      const publish = mock(() => Promise.resolve({ seq: 1 }));
      const jsm = {
        streams: {
          info: mock(() => Promise.resolve({ config: { name: "s" } })),
        },
      } as unknown as import("nats").JetStreamManager;
      const ingress = new IngressService(
        { publish } as unknown as import("nats").JetStreamClient,
        jsm,
      );

      await ingress.processInbound({
        tenantId: "tenant-a",
        channel: "whatsapp",
        provider: "meta",
        accountId: "acc-1",
        messages: [
          {
            messageId: "m-1",
            from: "+1",
            timestamp: `${Date.now()}`,
            type: "text",
            text: "hello",
            raw: {},
          },
        ],
      });

      expect(publish).toHaveBeenCalledTimes(1);
    });
  });

  describe("EgressService", () => {
    it("throws NotFoundException when account does not exist", async () => {
      const breaker = {
        canProceed: mock(() =>
          Promise.resolve({
            action: "allow" as const,
            status: "closed" as const,
            reason: "fresh",
          }),
        ),
        recordSuccess: mock(() => undefined),
        recordFailure: mock(() => undefined),
      } as unknown as import("@yoizen/shared").DistributedCircuitBreaker;
      const service = new EgressService(
        { publish: mock(() => Promise.resolve({ seq: 1 })) } as unknown as import("nats").JetStreamClient,
        {} as import("nats").JetStreamManager,
        { getOrThrow: mock() } as unknown as import("../../src/providers/channel-router").ChannelRouter,
        { findById: mock(() => Promise.resolve(null)) } as unknown as import("../../src/modules/accounts/accounts.service").AccountsService,
        breaker,
      );

      try {
        await service.send("tenant-a", "missing", {
          to: "user",
          type: "text",
          text: "hello",
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe("AutoReplyService", () => {
    it("creates and lists rules", async () => {
      const egress = {
        send: mock(() => Promise.resolve({ success: true })),
      } as unknown as import("../../src/modules/egress/egress.service").EgressService;

      const repo = {
        loadActiveRules: mock(() => Promise.resolve([])),
        insertRule: mock(() => Promise.resolve()),
        listRulesForTenant: mock(() => Promise.resolve([])),
        deleteRule: mock(() => Promise.resolve({ count: 0 })),
      } as unknown as AutoReplyRepository;

      const jsm = {} as unknown as import("nats").JetStreamManager;
      const js = {} as unknown as import("nats").JetStreamClient;
      const service = new AutoReplyService(jsm, js, repo, egress);

      const rule = await service.createRule({
        tenantId: "tenant-a",
        accountId: "acc-1",
        channel: "whatsapp",
        triggerPattern: "hello",
        replyText: "Hi there",
      });

      expect(rule.replyText).toBe("Hi there");
      expect(rule.isActive).toBe(true);
    });
  });
});
