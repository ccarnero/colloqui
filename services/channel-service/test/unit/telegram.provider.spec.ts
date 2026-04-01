import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { ChannelAccount, OutboundMessage } from "@yoizen/shared";

const tracedFetch = mock(
  (): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
);

mock.module("@yoizen/observability", () => ({
  tracedFetch,
}));

const { TelegramProvider } = await import(
  "../../src/providers/telegram/telegram.provider",
);

function baseAccount(overrides: Partial<ChannelAccount> = {}): ChannelAccount {
  return {
    id: "acc-1",
    tenantId: "tenant-1",
    channel: "telegram",
    provider: "telegram",
    name: "Bot",
    externalId: "ext-1",
    accessToken: "fallback-token",
    telegramBotToken: "bot-token",
    isActive: true,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TelegramProvider", () => {
  let provider: InstanceType<typeof TelegramProvider>;

  beforeEach(() => {
    tracedFetch.mockReset();
    tracedFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, result: { message_id: 99 } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    provider = new TelegramProvider();
  });

  describe("sendMessage", () => {
    it("sends a text message via Bot API", async () => {
      const account = baseAccount();
      const message: OutboundMessage = {
        to: "12345",
        type: "text",
        text: "Hello",
      };

      const result = await provider.sendMessage(account, message);

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe("99");
      expect(tracedFetch).toHaveBeenCalled();
      const call = tracedFetch.mock.calls[0];
      expect(call?.[0]).toContain("api.telegram.org/botbot-token/sendMessage");
      const init = call?.[1] as RequestInit;
      expect(init?.method).toBe("POST");
      expect(init?.body).toContain("Hello");
    });

    it("uses accessToken when telegramBotToken is absent", async () => {
      const account = baseAccount({ telegramBotToken: undefined });
      const message: OutboundMessage = {
        to: "1",
        type: "text",
        text: "Hi",
      };

      await provider.sendMessage(account, message);

      expect(tracedFetch.mock.calls[0]?.[0]).toContain(
        "api.telegram.org/botfallback-token/",
      );
    });

    it("returns structured error when API responds with non-OK HTTP", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response("bad token", {
            status: 401,
            statusText: "Unauthorized",
          }),
        ),
      );

      const result = await provider.sendMessage(baseAccount(), {
        to: "1",
        type: "text",
        text: "x",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 401");
    });

    it("returns failure when JSON body has ok: false", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const result = await provider.sendMessage(baseAccount(), {
        to: "1",
        type: "text",
        text: "x",
      });

      expect(result.success).toBe(false);
    });

    it("surfaces network errors from tracedFetch", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.reject(new Error("network down")),
      );

      const result = await provider.sendMessage(baseAccount(), {
        to: "1",
        type: "text",
        text: "x",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("network down");
    });
  });

  describe("registerWebhook", () => {
    it("calls setWebhook with URL and secret token", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, description: "Webhook set" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const result = await provider.registerWebhook(
        "my-token",
        "https://example.com/hook",
        "secret-xyz",
      );

      expect(result.ok).toBe(true);
      expect(tracedFetch).toHaveBeenCalledTimes(1);
      const call = tracedFetch.mock.calls[0];
      expect(call?.[0]).toBe(
        "https://api.telegram.org/botmy-token/setWebhook",
      );
      const init = call?.[1] as RequestInit;
      const body = JSON.parse(String(init?.body));
      expect(body.url).toBe("https://example.com/hook");
      expect(body.secret_token).toBe("secret-xyz");
      expect(body.allowed_updates).toEqual(["message", "channel_post"]);
    });

    it("returns Telegram error payload when ok is false", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              description: "Invalid webhook URL",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      const result = await provider.registerWebhook("t", "https://bad", "s");

      expect(result.ok).toBe(false);
      expect(result.description).toBe("Invalid webhook URL");
    });
  });

  describe("verifySignature", () => {
    it("returns true when signature matches secret (length and bytes)", () => {
      const secret = "my-secret-token";
      const ok = provider.verifySignature(
        new Uint8Array([1, 2, 3]),
        secret,
        secret,
      );
      expect(ok).toBe(true);
    });

    it("returns false when lengths differ", () => {
      const ok = provider.verifySignature(
        new Uint8Array(),
        "short",
        "longer-secret",
      );
      expect(ok).toBe(false);
    });
  });

  describe("parseWebhook", () => {
    it("parses a text message from message payload", () => {
      const raw = {
        message: {
          message_id: 10,
          date: 1700000000,
          chat: { id: 55 },
          from: { id: 77 },
          text: "Inbound",
        },
      };

      const msgs = provider.parseWebhook(raw);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.text).toBe("Inbound");
      expect(msgs[0]?.from).toBe("77");
    });
  });
});
