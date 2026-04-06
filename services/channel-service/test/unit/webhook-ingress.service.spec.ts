import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
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
    const req = {
      body: {},
      rawBody: raw,
      headers: { "x-hub-signature-256": "sha256=aa" },
    } as never;
    const out = await service.handleMetaWebhookPost("whatsapp", "t1", req);
    expect(out.status).toBe("no_messages");
  });

  it("throws when channel unsupported", async () => {
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
    await expect(
      svc.handleMetaWebhookPost("unknown", "t1", {
        body: {},
        rawBody: Buffer.from("{}"),
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
