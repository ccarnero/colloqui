import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { WebhookIngressService } from "../../src/modules/webhooks/webhook-ingress.service";
import { ChannelRouter } from "../../src/providers/channel-router";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import { AccountsService } from "../../src/modules/accounts/accounts.service";

describe("WebhookIngressService", () => {
  let service: WebhookIngressService;

  beforeEach(async () => {
    const mockProvider = {
      signatureHeader: "x-hub-signature-256",
      parseWebhook: mock(() => []),
      verifySignature: mock(() => true),
    };
    const mockRouter = {
      get: mock(() => mockProvider),
    };
    const mockIngress = { processInbound: mock(() => Promise.resolve()) };
    const mockAccounts = {
      listActive: mock(() =>
        Promise.resolve([{ id: "a1", appSecret: "secret" }]),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIngressService,
        { provide: ChannelRouter, useValue: mockRouter },
        { provide: IngressService, useValue: mockIngress },
        { provide: AccountsService, useValue: mockAccounts },
      ],
    }).compile();

    service = moduleRef.get(WebhookIngressService);
  });

  it("returns no_messages when parse yields none", async () => {
    const raw = Buffer.from("{}", "utf8");
    const out = await service.processEnvelope(
      "whatsapp",
      "t1",
      raw,
      { "x-hub-signature-256": "sha256=aa" },
      {},
    );
    expect(out.status).toBe("no_messages");
  });

  it("returns unsupported_channel when channel is unknown", async () => {
    const mockRouter = { get: mock(() => undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIngressService,
        { provide: ChannelRouter, useValue: mockRouter },
        { provide: IngressService, useValue: { processInbound: mock() } },
        {
          provide: AccountsService,
          useValue: { listActive: mock(() => Promise.resolve([])) },
        },
      ],
    }).compile();
    const svc = moduleRef.get(WebhookIngressService);
    const out = await svc.processEnvelope(
      "unknown",
      "t1",
      Buffer.from("{}"),
      {},
      {},
    );
    expect(out.status).toBe("unsupported_channel");
  });
});
