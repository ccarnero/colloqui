import { describe, it, expect } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import type { Channel, IChannelProvider } from "@yoizen/shared";
import { ChannelRouter } from "../../src/providers/channel-router";
import type { ProviderRegistry } from "../../src/providers/meta/provider-registry";
import type { TelegramProvider } from "../../src/providers/telegram/telegram.provider";

function stubProvider(
  channel: Channel,
  providerKind: IChannelProvider["provider"],
): IChannelProvider {
  return {
    channel,
    provider: providerKind,
    parseWebhook: () => [],
    sendMessage: async () => ({
      success: true,
      timestamp: new Date().toISOString(),
    }),
    verifySignature: () => true,
  };
}

describe("ChannelRouter", () => {
  const whatsapp = stubProvider("whatsapp", "meta");
  const instagram = stubProvider("instagram", "meta");
  const telegram = stubProvider("telegram", "telegram") as unknown as TelegramProvider;

  const metaRegistry = {
    channels: () => ["whatsapp", "instagram"] as Channel[],
    get: (ch: Channel): IChannelProvider | undefined => {
      if (ch === "whatsapp") return whatsapp;
      if (ch === "instagram") return instagram;
      return undefined;
    },
  } as unknown as ProviderRegistry;

  const router = new ChannelRouter(metaRegistry, telegram);

  it("routes whatsapp to Meta WhatsApp provider", () => {
    expect(router.get("whatsapp")).toBe(whatsapp);
  });

  it("routes instagram to Meta Instagram provider", () => {
    expect(router.get("instagram")).toBe(instagram);
  });

  it("routes telegram to Telegram provider", () => {
    expect(router.get("telegram")).toBe(telegram);
  });

  it("returns undefined for unregistered channel", () => {
    expect(router.get("unknown" as Channel)).toBeUndefined();
  });

  it("getOrThrow throws NotFoundException for unknown channel", () => {
    expect(() => router.getOrThrow("unknown" as Channel)).toThrow(
      NotFoundException,
    );
    expect(() => router.getOrThrow("unknown" as Channel)).toThrow(
      /No provider registered/,
    );
  });

  it("channels lists meta channels plus telegram", () => {
    const keys = new Set(router.channels());
    expect(keys.has("whatsapp")).toBe(true);
    expect(keys.has("instagram")).toBe(true);
    expect(keys.has("telegram")).toBe(true);
    expect(keys.size).toBe(3);
  });
});
