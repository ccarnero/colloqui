import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { ChannelAccount, InboundMessage } from "@yoizen/shared";
import { AccountsService } from "../../src/modules/accounts/accounts.service";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import { WebhookIngressService } from "../../src/modules/webhooks/webhook-ingress.service";
import { ChannelRouter } from "../../src/providers/channel-router";

function createAccount(
  overrides: Partial<ChannelAccount> = {}
): ChannelAccount {
  return {
    id: overrides.id ?? "a1",
    tenantId: overrides.tenantId ?? "t1",
    channel: overrides.channel ?? "telegram",
    provider: overrides.provider ?? "telegram",
    name: overrides.name ?? "Primary",
    externalId: overrides.externalId ?? "ext-1",
    accessToken: overrides.accessToken ?? "token",
    appSecret: overrides.appSecret ?? "secret",
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...(overrides.telegramBotToken && {
      telegramBotToken: overrides.telegramBotToken,
    }),
  };
}

function createInboundMessage(
  overrides: Partial<InboundMessage> = {}
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
    provider: "telegram" | "http";
    signatureHeader: string;
    parseWebhook: ReturnType<typeof mock>;
    verifySignature: ReturnType<typeof mock>;
  };
  let mockRouter: { get: ReturnType<typeof mock> };
  let mockIngress: { processInbound: ReturnType<typeof mock> };
  let mockAccounts: { listActive: ReturnType<typeof mock> };

  beforeEach(async () => {
    mockProvider = {
      provider: "telegram",
      signatureHeader: "x-telegram-bot-api-secret-token",
      parseWebhook: mock(() => []),
      verifySignature: mock(() => true),
    };
    mockRouter = {
      get: mock(() => mockProvider),
    };
    mockIngress = { processInbound: mock(() => Promise.resolve()) };
    mockAccounts = {
      listActive: mock(() => Promise.resolve([createAccount()])),
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
      "telegram",
      "t1",
      raw,
      { "x-telegram-bot-api-secret-token": "secret" },
      {}
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
      {}
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
        secret === "secret-2"
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
      { message: { text: "chocho" } }
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "telegram",
      provider: "telegram",
      accountId: "a2",
      messages: [createInboundMessage({ text: "chocho" })],
      // envelope-drift item 3 + 2026-08-01 secret strip: the stage-1
      // allowlist rides along to `data.headers`, but the verification-secret
      // subset (here the only header) is dropped once the signature check
      // has used it.
      webhookHeaders: {},
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
          createAccount({
            id: "http-a",
            channel: "http",
            provider: "http",
            externalId: "webhook1",
            appSecret: "s1",
          }),
          createAccount({
            id: "http-b",
            channel: "http",
            provider: "http",
            externalId: "webhook2",
            appSecret: "s2",
          }),
        ])
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
      "webhook2"
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(ingress.processInbound).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "http-b" })
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
          createAccount({
            id: "http-a",
            channel: "http",
            provider: "http",
            externalId: "webhook1",
            appSecret: "s1",
          }),
        ])
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIngressService,
        { provide: ChannelRouter, useValue: { get: mock(() => httpProvider) } },
        {
          provide: IngressService,
          useValue: { processInbound: mock(() => Promise.resolve()) },
        },
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
      "does-not-exist"
    );

    expect(out.status).toBe("unknown_instance");
  });

  it("rejects webhooks it cannot resolve to a unique account", async () => {
    // Two accounts share a secret, so both verify. The payload-metadata
    // disambiguation went away with the Meta family: an ambiguous
    // verification is now always a rejection, never a guess.
    mockProvider.parseWebhook.mockReturnValue([createInboundMessage()]);
    mockProvider.verifySignature.mockReturnValue(true);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "tg-1",
        channel: "telegram",
        provider: "telegram",
        appSecret: "shared-secret",
      }),
      createAccount({
        id: "tg-2",
        channel: "telegram",
        provider: "telegram",
        appSecret: "shared-secret",
      }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      { "x-telegram-bot-api-secret-token": "shared-secret" },
      { message: { text: "hello" } }
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });

  it("rejects an unsigned webhook even with a single active account", async () => {
    // Regression pin for the removed Meta legacy fallback: a missing
    // signature used to route to `activeAccounts[0]`. It must now be
    // rejected for every channel, single account or not.
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "hello" }),
    ]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({ id: "single" }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      {},
      { message: { text: "hello" } }
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });

  it("rejects a webhook when the provider declares no signature header", async () => {
    // Regression pin for the removed Meta legacy fallback on the other
    // branch: a provider without `signatureHeader` (the e2e-tests sink)
    // yields no signature to check, so there is nothing to authenticate
    // against and the request must be rejected rather than fall back to the
    // first active account.
    const sinkProvider = {
      provider: "e2e-tests",
      parseWebhook: mock(() => [createInboundMessage({ text: "hello" })]),
      verifySignature: mock(() => false),
    };
    const ingress = { processInbound: mock(() => Promise.resolve()) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookIngressService,
        { provide: ChannelRouter, useValue: { get: mock(() => sinkProvider) } },
        { provide: IngressService, useValue: ingress },
        {
          provide: AccountsService,
          useValue: {
            listActive: mock(() =>
              Promise.resolve([
                createAccount({
                  id: "sink-1",
                  channel: "e2e-tests",
                  provider: "e2e-tests",
                }),
              ])
            ),
          },
        },
      ],
    }).compile();
    const svc = moduleRef.get(WebhookIngressService);

    const out = await svc.processEnvelope(
      "e2e-tests",
      "t1",
      Buffer.from("{}"),
      {},
      { from: "u", text: "hello" }
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(ingress.processInbound).not.toHaveBeenCalled();
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
      { message: { text: "hola" } }
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
      { message: { text: "hola" } }
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
      { from: "user-1", text: "hello" }
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
        signature === secret
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
      { from: "user-1", text: "hello" }
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
        secret === "secret-1"
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
      { message: { text: "ola" } }
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith({
      tenantId: "t1",
      channel: "telegram",
      provider: "telegram",
      accountId: "a1",
      messages: [createInboundMessage({ text: "ola" })],
      // envelope-drift item 3 + 2026-08-01 secret strip: the secret token
      // routed the message to account a1 and is dropped before stage 2.
      webhookHeaders: {},
    });
  });

  it("strips only the verification-secret headers; the rest reach stage 2", async () => {
    // Regression for the 2026-08-01 decision (envelope-drift open decision
    // 0/2): stage-2 `data.headers` must never carry a verification secret,
    // while the non-secret allowlist entries keep flowing verbatim.
    mockProvider.provider = "telegram";
    mockProvider.signatureHeader = "x-telegram-bot-api-secret-token";
    mockProvider.parseWebhook.mockReturnValue([
      createInboundMessage({ text: "ola" }),
    ]);
    mockProvider.verifySignature.mockReturnValue(true);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({
        id: "a1",
        channel: "telegram",
        provider: "telegram",
        appSecret: "secret-1",
      }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-1",
        "x-hub-signature-256": "sha256=stray",
        "x-hub-signature": "sha1=stray",
        "x-http-channel-token": "stray",
        "x-request-id": "req-1",
        "user-agent": "TelegramBot",
      },
      { message: { text: "ola" } }
    );

    expect(out.status).toBe("accepted");
    await flushImmediate();
    expect(mockIngress.processInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookHeaders: {
          "content-type": "application/json",
          "x-request-id": "req-1",
          "user-agent": "TelegramBot",
        },
      })
    );
  });

  it("rejects an unsigned webhook when multiple accounts are active", async () => {
    // Second half of the removed-fallback pin: with more than one active
    // account an unsigned request used to silently pick the first one.
    const inbound = createInboundMessage({ text: "hello" });
    mockProvider.parseWebhook.mockReturnValue([inbound]);
    mockAccounts.listActive.mockResolvedValue([
      createAccount({ id: "tg-1", appSecret: "secret-1" }),
      createAccount({ id: "tg-2", appSecret: "secret-2" }),
    ]);

    const out = await service.processEnvelope(
      "telegram",
      "t1",
      Buffer.from("{}"),
      {},
      { message: { text: "hello" } }
    );

    expect(out.status).toBe("signature_mismatch");
    await flushImmediate();
    expect(mockIngress.processInbound).not.toHaveBeenCalled();
  });
});
