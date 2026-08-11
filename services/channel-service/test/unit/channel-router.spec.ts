import { beforeEach, describe, expect, it } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ChannelRouter } from "../../src/providers/channel-router";
import { E2eTestsProvider } from "../../src/providers/e2e-tests/e2e-tests.provider";
import { HttpProvider } from "../../src/providers/http/http.provider";
import { TelegramProvider } from "../../src/providers/telegram/telegram.provider";

describe("ChannelRouter", () => {
  let router: ChannelRouter;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelRouter,
        TelegramProvider,
        HttpProvider,
        E2eTestsProvider,
      ],
    }).compile();
    router = moduleRef.get(ChannelRouter);
  });

  it("resolves the telegram provider", () => {
    expect(router.get("telegram")).toBeDefined();
  });

  it("resolves nothing for a decommissioned channel token", () => {
    // The Meta family is gone: a token the router no longer registers must
    // resolve to `undefined` (the ingress path turns that into
    // `unsupported_channel`), never to a leftover provider. The cast is the
    // point — `"whatsapp"` left the `Channel` union with the contract shrink,
    // so only an out-of-contract caller can even ask for it.
    expect(router.get("whatsapp" as never)).toBeUndefined();
    expect(router.get("instagram" as never)).toBeUndefined();
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
    expect(() => router.getOrThrow("whatsapp" as never)).toThrow(
      NotFoundException
    );
  });
});
