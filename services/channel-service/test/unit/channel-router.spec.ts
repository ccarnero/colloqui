import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ChannelRouter } from "../../src/providers/channel-router";
import { ProviderRegistry } from "../../src/providers/meta/provider-registry";
import { WhatsAppProvider } from "../../src/providers/meta/whatsapp/whatsapp.provider";
import { InstagramProvider } from "../../src/providers/meta/instagram/instagram.provider";
import { TelegramProvider } from "../../src/providers/telegram/telegram.provider";

describe("ChannelRouter", () => {
  let router: ChannelRouter;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelRouter,
        ProviderRegistry,
        WhatsAppProvider,
        InstagramProvider,
        TelegramProvider,
      ],
    }).compile();
    router = moduleRef.get(ChannelRouter);
  });

  it("resolves Meta and Telegram providers", () => {
    expect(router.get("whatsapp")).toBeDefined();
    expect(router.get("instagram")).toBeDefined();
    expect(router.get("telegram")).toBeDefined();
  });

  it("getOrThrow throws for unknown channel", () => {
    expect(() => router.getOrThrow("slack" as never)).toThrow(NotFoundException);
  });
});
