import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { ChannelAccount, InboundMessage } from "@yoizen/shared";
import { WebhookIngressService } from "../../src/modules/webhooks/webhook-ingress.service";
import { ChannelRouter } from "../../src/providers/channel-router";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import { AccountsService } from "../../src/modules/accounts/accounts.service";

function createAccount(
  overrides: Partial<ChannelAccount> = {},
): ChannelAccount {
  return {
    id: overrides.id ?? "a1",
    tenantId: overrides.tenantId ?? "t1",
    channel: overrides.channel ?? "whatsapp",
    provider: overrides.provider ?? "meta",
    name: overrides.name ?? "Primary",
    externalId: overrides.externalId ?? "ext-1",
    accessToken: overrides.accessToken ?? "token",
    appSecret: overrides.appSecret ?? "secret",
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...(overrides.phoneNumberId && { phoneNumberId: overrides.phoneNumberId }),
    ...(overrides.igUserId && { igUserId: overrides.igUserId }),
    ...(overrides.telegramBotToken && {
      telegramBotToken: overrides.telegramBotToken,
    }),
  };
}

function createInboundMessage(
  overrides: Partial<InboundMessage> = {},
): InboundMessage {
  return {
    messageId: overrides.messageId ?? "m1",
    from: overrides.from ?? "123",
    timestamp: overrides.timestamp ?? "1700000000",
    type: overrides.type ?? "text",
    raw: overrides.raw ?? {},
    ...(overrides.text && { text: overrides.text }),
    ...(overrides.media && { media: overrides.media }),
  };
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("WebhookIngressService", () => {
  let service: WebhookIngressService;
  let mockProvider: {
    provider: "meta" | "telegram";
    signatureHeader: string;
    parseWebhook: ReturnType<typeof mock>;
    verifySignature: ReturnType<typeof mock>;
  };
  let mockRouter: { get: ReturnType<typeof mock> };
  let mockIngress: { processInbound: ReturnType<typeof mock> };
  let mockAccounts: { listActive: ReturnType<typeof mock> };

  beforeEach(async () => {
    mockProvider = {
      provider: "meta",
      signatureHeader: "x-hub-signature-256",
      parseWebhook: mock(() => []),
      verifySignature: mock(() => true),
    };
    mockRouter = {
      get: mock(() => mockProvider),
    };
    mockIngress = { processInbound: mock(() => Promise.resolve()) };
    mockAccounts = {
      listActive: mock(() =>
        Promise.resolve([createAccount()]),
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

  it("uses the second Telegram account when its secret token matches", async () => {
    mockProvider.provider = "telegram";
    mockProvider.signatureHeader = "x-telegram-bot-api-secret-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "chocho" }),
    ]);
    mockProvider.verifySignature.mockImplementation(
      (_rawBody: Buffer, _signature: string, secret: string) =>
        secret === "secret-2",
    );
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "a1",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-1",
      }),
      createAccount({
        id: "a2",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-2",
      }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      { "x-telegram-bot-api-secret-token": "token" },
      { message: { text: "chocho" } },
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "telegram",
      provider: "telegram",
      accountId: "a2",
      messages: [createInboundMessage({ text: "chocho" })],
      // envelope-drift item 3: the stage-1 allowlist now rides along to
      // `data.headers`; it is the same object this test handed to
      // processEnvelope, forwarded verbatim.
      webhookHeaders: { "x-telegram-bot-api-secret-token": "token" },
    });
  });

  it("instance-addressed http: routes to the account whose externalId matches", async () => {
    // Both secrets "verify" — without the URL instance this would be ambiguous
    // (signature_mismatch). The path segment must pick the right account.
    const httpProvider = {
      provider: "http",
      signatureHeader: "x-http-channel-token",
      parseWebhook: mock(() => [createInboundMessage({ text: "hola" })]),
      verifySignature: mock(() => true),
    };
    const ingress = { processInbound: mock(() => Promise.resolve()) };
    const accounts = {
      listActive: mock(() =>
        Promise.resolve([
          createAccount({ id: "http-a", channel: "http", provider: "http", externalId: "webhook1", appSecret: "s1" }),
          createAccount({ id: "http-b", channel: "http", provider: "http", externalId: "webhook2", appSecret: "s2" }),
        ]),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIngressService,
        { provide: ChannelRouter, useValue: { get: mock(() => httpProvider) } },
        { provide: IngressService, useValue: ingress },
        { provide: AccountsService, useValue: accounts },
      ],
    }).compile();
    const svc = moduleRef.get(WebhookIngressService);

    const out = await svc.processEnvelope(
      "http",
      "t1",
      Buffer.from("{}"),
      { "x-http-channel-token": "tok" },
      { from: "u", text: "hola" },
      undefined,
      "webhook2",
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(ingress.processInbound).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "http-b" }),
    );
  });

  it("instance-addressed http: unknown externalId is rejected", async () => {
    const httpProvider = {
      provider: "http",
      signatureHeader: "x-http-channel-token",
      parseWebhook: mock(() => [createInboundMessage({ text: "hola" })]),
      verifySignature: mock(() => true),
    };
    const accounts = {
      listActive: mock(() =>
        Promise.resolve([
          createAccount({ id: "http-a", channel: "http", provider: "http", externalId: "webhook1", appSecret: "s1" }),
        ]),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIngressService,
        { provide: ChannelRouter, useValue: { get: mock(() => httpProvider) } },
        { provide: IngressService, useValue: { processInbound: mock(() => Promise.resolve()) } },
        { provide: AccountsService, useValue: accounts },
      ],
    }).compile();
    const svc = moduleRef.get(WebhookIngressService);

    const out = await svc.processEnvelope(
      "http",
      "t1",
      Buffer.from("{}"),
      { "x-http-channel-token": "tok" },
      { from: "u", text: "hola" },
      undefined,
      "does-not-exist",
    );

    expect(out.status).toBe("unknown_instance");
  });

  it("disambiguates WhatsApp accounts by phone_number_id when multiple verify", async () => {
    const inbound = createInboundMessage({ text: "hello" });
    mockProvider.parseWebhook.mockReturnValue([inbound]);
    mockProvider.verifySignature.mockReturnValue(true);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "wa-1",
        channel: "whatsapp",
        provider: "meta",
        phoneNumberId: "pn-1",
        appSecret: "shared-secret",
      }),
      createAccount({
        id: "wa-2",
        channel: "whatsapp",
        provider: "meta",
        phoneNumberId: "pn-2",
        appSecret: "shared-secret",
      }),
    ]);

    const out = await service.processEnvelope(
      "whatsapp",
      "t1",
      Buffer.from("{}"),
      { "x-hub-signature-256": "sha256=ok" },
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "pn-2" },
                  messages: [{ text: { body: "hello" } }],
                },
              },
            ],
          },
        ],
      },
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "whatsapp",
      provider: "meta",
      accountId: "wa-2",
      messages: [inbound],
      // envelope-drift item 3: the stage-1 allowlist now rides along to
      // `data.headers`; it is the same object this test handed to
      // processEnvelope, forwarded verbatim.
      webhookHeaders: { "x-hub-signature-256": "sha256=ok" },
    });
  });

  it("rejects ambiguous Meta webhooks when it cannot resolve a unique account", async () => {
    mockProvider.parseWebhook.mockReturnValue([createInboundMessage()]);
    mockProvider.verifySignature.mockReturnValue(true);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "ig-1",
        channel: "instagram",
        provider: "meta",
        appSecret: "shared-secret",
        igUserId: "ig-1",
      }),
      createAccount({
        id: "ig-2",
        channel: "instagram",
        provider: "meta",
        appSecret: "shared-secret",
        igUserId: "ig-2",
      }),
    ]);

    const out = await service.processEnvelope(
      "instagram",
      "t1",
      Buffer.from("{}"),
      { "x-hub-signature-256": "sha256=ok" },
      {
        entry: [
          {
            messaging: [
              {
                sender: { id: "user-1" },
                message: { mid: "mid-1", text: "hello" },
                timestamp: 123,
              },
            ],
          },
        ],
      },
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });

  it("keeps single-account behavior when no signature header is present", async () => {
    const inbound = createInboundMessage({ text: "hello" });
    mockProvider.parseWebhook.mockReturnValue([inbound]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "single",
        channel: "whatsapp",
        provider: "meta",
      }),
    ]);

    const out = await service.processEnvelope(
      "whatsapp",
      "t1",
      Buffer.from("{}"),
      {},
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "pn-1" },
                  messages: [{ text: { body: "hello" } }],
                },
              },
            ],
          },
        ],
      },
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "whatsapp",
      provider: "meta",
      accountId: "single",
      messages: [inbound],
      // envelope-drift item 3: the stage-1 allowlist now rides along to
      // `data.headers`; it is the same object this test handed to
      // processEnvelope, forwarded verbatim.
      webhookHeaders: {},
    });
  });

  it("rejects Telegram webhook when the signature header is missing", async () => {
    mockProvider.provider = "telegram";
    mockProvider.signatureHeader = "x-telegram-bot-api-secret-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "hola" }),
    ]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "a1",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-1",
      }),
      createAccount({
        id: "a2",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-2",
      }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      {},
      { message: { text: "hola" } },
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhook when the signature header is empty", async () => {
    mockProvider.provider = "telegram";
    mockProvider.signatureHeader = "x-telegram-bot-api-secret-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "hola" }),
    ]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "a1",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-1",
      }),
      createAccount({
        id: "a2",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-2",
      }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      { "x-telegram-bot-api-secret-token": "" },
      { message: { text: "hola" } },
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });

  it("rejects http webhook when the signature header is missing", async () => {
    mockProvider.provider = "http" as never;
    mockProvider.signatureHeader = "x-http-channel-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "hello" }),
    ]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "h1",
        channel: "http" as never,
        provider: "http" as never,
        appSecret: "my-secret",
      }),
    ]);

    const out = await service.processEnvelope(
      "http",
      "t1",
      Buffer.from("{}"),
      {},
      { from: "user-1", text: "hello" },
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });

  it("accepts http webhook when token matches", async () => {
    mockProvider.provider = "http" as never;
    mockProvider.signatureHeader = "x-http-channel-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "hello" }),
    ]);
    mockProvider.verifySignature.mockImplementation(
      (_rawBody: Buffer, signature: string, secret: string) =>
        signature === secret,
    );
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "h1",
        channel: "http" as never,
        provider: "http" as never,
        appSecret: "my-secret",
      }),
    ]);

    const out = await service.processEnvelope(
      "http",
      "t1",
      Buffer.from("{}"),
      { "x-http-channel-token": "my-secret" },
      { from: "user-1", text: "hello" },
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalled();
  });

  it("uses the first Telegram account when its secret token matches", async () => {
    mockProvider.provider = "telegram";
    mockProvider.signatureHeader = "x-telegram-bot-api-secret-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "ola" }),
    ]);
    mockProvider.verifySignature.mockImplementation(
      (_rawBody: Buffer, _signature: string, secret: string) =>
        secret === "secret-1",
    );
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "a1",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-1",
      }),
      createAccount({
        id: "a2",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-2",
      }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      { "x-telegram-bot-api-secret-token": "secret-1" },
      { message: { text: "ola" } },
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "telegram",
      provider: "telegram",
      accountId: "a1",
      messages: [createInboundMessage({ text: "ola" })],
      // envelope-drift item 3: the stage-1 allowlist now rides along to
      // `data.headers`; it is the same object this test handed to
      // processEnvelope, forwarded verbatim.
      webhookHeaders: { "x-telegram-bot-api-secret-token": "secret-1" },
    });
  });

  it("keeps WhatsApp fallback to first account when signature is absent and multiple accounts exist", async () => {
    const inbound = createInboundMessage({ text: "hello" });
    mockProvider.parseWebhook.mockReturnValue([inbound]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "wa-1",
        channel: "whatsapp",
        provider: "meta",
        phoneNumberId: "pn-1",
      }),
      createAccount({
        id: "wa-2",
        channel: "whatsapp",
        provider: "meta",
        phoneNumberId: "pn-2",
      }),
    ]);

    const out = await service.processEnvelope(
      "whatsapp",
      "t1",
      Buffer.from("{}"),
      {},
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "pn-1" },
                  messages: [{ text: { body: "hello" } }],
                },
              },
            ],
          },
        ],
      },
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "whatsapp",
      provider: "meta",
      accountId: "wa-1",
      messages: [inbound],
      // envelope-drift item 3: the stage-1 allowlist now rides along to
      // `data.headers`; it is the same object this test handed to
      // processEnvelope, forwarded verbatim.
      webhookHeaders: {},
    });
  });
});
