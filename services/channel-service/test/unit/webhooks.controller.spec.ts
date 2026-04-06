import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { WebhooksController } from "../../src/modules/webhooks/webhooks.controller";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import { AccountsService } from "../../src/modules/accounts/accounts.service";
import { WebhookIngressService } from "../../src/modules/webhooks/webhook-ingress.service";
import { ChannelRouter } from "../../src/providers/channel-router";

describe("WebhooksController", () => {
  let controller: WebhooksController;

  beforeEach(async () => {
    const mockIngress = { processInbound: mock(() => Promise.resolve()) };
    const mockAccounts = {
      listActive: mock(() =>
        Promise.resolve([{ id: "acc-1", appSecret: "sec" }]),
      ),
      findByVerifyToken: mock(() =>
        Promise.resolve({ id: "acc-1", appSecret: "sec" }),
      ),
    };
    const mockRouter = {
      get: mock(() => ({
        provider: "meta",
        signatureHeader: "x-hub-signature-256",
        verifySignature: () => true,
        parseWebhook: () => [],
      })),
    };

    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: ChannelRouter, useValue: mockRouter },
        WebhookIngressService,
        { provide: IngressService, useValue: mockIngress },
        { provide: AccountsService, useValue: mockAccounts },
      ],
    }).compile();

    controller = module.get(WebhooksController);
  });

  it("verify returns challenge when token matches", async () => {
    const out = await controller.verify(
      "whatsapp",
      "t1",
      {
        mode: "subscribe",
        verifyToken: "tok",
        challenge: "ch-123",
      } as never,
    );
    expect(out).toBe("ch-123");
  });

  it("receive completes when signature matches raw body (no messages)", async () => {
    const raw = Buffer.from(JSON.stringify({ object: "test" }), "utf8");
    const req = {
      url: "/webhooks/whatsapp/t1",
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=abc" },
      body: { object: "test" },
      rawBody: raw,
    } as never;

    const out = await controller.receive("whatsapp", "t1", req);
    expect(out.status).toBe("no_messages");
  });
});
