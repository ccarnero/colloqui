import { beforeEach, describe, expect, it } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ChannelRouter } from "../../src/providers/channel-router";
import { E2eTestsProvider } from "../../src/providers/e2e-tests/e2e-tests.provider";
import { HttpProvider } from "../../src/providers/http/http.provider";
import { InstagramProvider } from "../../src/providers/meta/instagram/instagram.provider";
import { ProviderRegistry } from "../../src/providers/meta/provider-registry";
import { WhatsAppProvider } from "../../src/providers/meta/whatsapp/whatsapp.provider";
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
        HttpProvider,
        E2eTestsProvider,
      ],
    }).compile();
    router = moduleRef.get(ChannelRouter);
  });

  it("resolves Meta and Telegram providers", () => {
    expect(router.get("whatsapp")).toBeDefined();
    expect(router.get("instagram")).toBeDefined();
    expect(router.get("telegram")).toBeDefined();
  });

  it("resolves the http provider", () => {
    expect(router.get("http")).toBeDefined();
  });

  it("resolves the e2e-tests sink provider", () => {
    expect(router.get("e2e-tests")).toBeDefined();
  });

  it("getOrThrow throws for unknown channel", () => {
    expect(() => router.getOrThrow("slack" as never)).toThrow(
      NotFoundException
    );
  });
});
