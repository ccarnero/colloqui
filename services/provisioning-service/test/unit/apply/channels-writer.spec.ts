import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ManifestChannel } from "@yoizen/shared";
import { createChannelsWriter } from "../../../src/modules/apply/infrastructure/channels-writer";

const BASE_URL = "http://channel-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createChannelsWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: refuses a channel with a secretRef when NO broker resolver is wired — never fabricates a credential", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network for a secretRef'd channel");
    }) as unknown as typeof fetch;

    const writer = createChannelsWriter(BASE_URL);
    const channel: ManifestChannel = {
      name: "wa-in",
      type: "whatsapp",
      direction: "inbound",
      secretRef: "wa-token",
    };

    const result = await writer.create("tenant-a", channel);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
      expect(result.error.resourceName).toBe("wa-in");
    }
  });

  it("create: T05 — resolves secretRef via the broker resolver and uses the real value as accessToken", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "chan-wa-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({
        ok: true as const,
        value: "real-wa-token",
      })),
    };
    const writer = createChannelsWriter(BASE_URL, resolver);
    const channel: ManifestChannel = {
      name: "wa-in",
      type: "whatsapp",
      direction: "inbound",
      secretRef: "wa-token",
    };

    const result = await writer.create("tenant-a", channel, {
      correlationId: "run-1",
    });
    expect(result.ok).toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      kind: "channel",
      owner: "wa-in",
      secretName: "wa-token",
      correlationId: "run-1",
    });
    expect(capturedBody).toMatchObject({ accessToken: "real-wa-token" });
  });

  it("create: T05 — a broker resolution failure still fails loud with secret_not_resolvable, never fabricating a value", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network when the broker denies");
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({ ok: false as const, error: "denied" })),
    };
    const writer = createChannelsWriter(BASE_URL, resolver);
    const channel: ManifestChannel = {
      name: "wa-in",
      type: "whatsapp",
      direction: "inbound",
      secretRef: "wa-token",
    };

    const result = await writer.create("tenant-a", channel);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
    }
  });

  it("create: an http channel without secretRef is created with a non-secret placeholder token", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "chan-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createChannelsWriter(BASE_URL);
    const channel: ManifestChannel = {
      name: "http-in",
      type: "http",
      direction: "inbound",
    };

    const result = await writer.create("tenant-a", channel);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("chan-1");
    }
    expect(capturedBody).toMatchObject({
      channel: "http",
      provider: "http",
      name: "http-in",
    });
  });

  it("create: an unsupported channel type fails loud with a typed error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network for an unsupported type");
    }) as unknown as typeof fetch;

    const writer = createChannelsWriter(BASE_URL);
    const channel: ManifestChannel = {
      name: "sms-in",
      type: "sms",
      direction: "inbound",
    };

    const result = await writer.create("tenant-a", channel);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported_kind_shape");
    }
  });

  it("update: a diff on the non-patchable 'type' field is a safe no-op (no HTTP call)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network for a non-mappable diff");
    }) as unknown as typeof fetch;

    const writer = createChannelsWriter(BASE_URL);
    const channel: ManifestChannel = {
      name: "http-in",
      type: "http",
      direction: "inbound",
    };

    const result = await writer.update("tenant-a", "chan-1", channel, [
      { field: "type" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("chan-1");
    }
  });

  it("update: a mappable 'name' diff issues a PATCH", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "chan-1" })
    ) as unknown as typeof fetch;

    const writer = createChannelsWriter(BASE_URL);
    const channel: ManifestChannel = {
      name: "http-in-renamed",
      type: "http",
      direction: "inbound",
    };

    const result = await writer.update("tenant-a", "chan-1", channel, [
      { field: "name" },
    ]);
    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
