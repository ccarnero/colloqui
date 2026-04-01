import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createHmac } from "crypto";
import type { ChannelAccount, OutboundMessage } from "@yoizen/shared";

const tracedFetch = mock(
  (): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ messages: [{ id: "wamid-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
);

mock.module("@yoizen/observability", () => ({
  tracedFetch,
}));

const { WhatsAppProvider } = await import(
  "../../src/providers/meta/whatsapp/whatsapp.provider",
);

function waAccount(overrides: Partial<ChannelAccount> = {}): ChannelAccount {
  return {
    id: "acc-wa",
    tenantId: "tenant-1",
    channel: "whatsapp",
    provider: "meta",
    name: "WA",
    externalId: "ext-wa",
    phoneNumberId: "phone-id-99",
    accessToken: "graph-token",
    isActive: true,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WhatsAppProvider", () => {
  let provider: InstanceType<typeof WhatsAppProvider>;

  beforeEach(() => {
    tracedFetch.mockReset();
    tracedFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [{ id: "wamid-x" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    provider = new WhatsAppProvider();
  });

  describe("sendMessage", () => {
    it("POSTs to Graph API messages edge with bearer token", async () => {
      const message: OutboundMessage = {
        to: "5491112345678",
        type: "text",
        text: "Hello WA",
      };

      const result = await provider.sendMessage(waAccount(), message);

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe("wamid-x");
      expect(tracedFetch).toHaveBeenCalledTimes(1);
      const call = tracedFetch.mock.calls[0];
      expect(call?.[0]).toBe(
        "https://graph.facebook.com/v21.0/phone-id-99/messages",
      );
      const init = call?.[1] as {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      };
      expect(init?.method).toBe("POST");
      expect(init?.headers?.Authorization).toBe("Bearer graph-token");
      const body = JSON.parse(String(init?.body));
      expect(body.messaging_product).toBe("whatsapp");
      expect(body.type).toBe("text");
      expect(body.text.body).toBe("Hello WA");
    });

    it("returns HTTP error details when Graph API rejects", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "Invalid OAuth" } }), {
            status: 400,
          }),
        ),
      );

      const result = await provider.sendMessage(waAccount(), {
        to: "1",
        type: "text",
        text: "x",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 400");
    });

    it("returns failure when fetch throws", async () => {
      tracedFetch.mockImplementationOnce(() =>
        Promise.reject(new Error("ECONNRESET")),
      );

      const result = await provider.sendMessage(waAccount(), {
        to: "1",
        type: "text",
        text: "x",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNRESET");
    });
  });

  describe("verifySignature", () => {
    it("accepts valid x-hub-signature-256", () => {
      const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
      const secret = "app-secret";
      const expected =
        "sha256=" +
        createHmac("sha256", secret).update(rawBody).digest("hex");

      expect(provider.verifySignature(rawBody, expected, secret)).toBe(true);
    });

    it("rejects tampered signature", () => {
      const rawBody = Buffer.from("payload");
      const secret = "s";
      const wrong = "sha256=deadbeef";

      expect(provider.verifySignature(rawBody, wrong, secret)).toBe(false);
    });
  });

  describe("parseWebhook", () => {
    it("extracts WhatsApp messages from Graph webhook shape", () => {
      const raw = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "m1",
                      from: "5491112345678",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: "Hi" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msgs = provider.parseWebhook(raw);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.messageId).toBe("m1");
      expect(msgs[0]?.text).toBe("Hi");
    });
  });
});
