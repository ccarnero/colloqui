import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { ProviderRegistry } from "../../src/providers/meta/provider-registry";
import { WhatsAppProvider } from "../../src/providers/meta/whatsapp/whatsapp.provider";
import { InstagramProvider } from "../../src/providers/meta/instagram/instagram.provider";

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ProviderRegistry, WhatsAppProvider, InstagramProvider],
    }).compile();
    registry = moduleRef.get(ProviderRegistry);
  });

  it("exposes whatsapp and instagram", () => {
    expect(registry.channels().sort()).toEqual(["instagram", "whatsapp"]);
    expect(registry.get("whatsapp")?.channel).toBe("whatsapp");
    expect(registry.get("instagram")?.channel).toBe("instagram");
  });
});
