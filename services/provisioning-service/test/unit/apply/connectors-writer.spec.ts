import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Connector } from "@yoizen/shared";
import { createConnectorsWriter } from "../../../src/modules/apply/infrastructure/connectors-writer";

const BASE_URL = "http://connector-admin.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createConnectorsWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: refuses a connector with an auth.bearerToken.secretRef when NO broker resolver is wired — never fabricates auth material", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error(
        "must never call the network for a secretRef'd connector"
      );
    }) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      auth: { authType: "bearer", bearerToken: { secretRef: "hubspot-key" } },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
      expect(result.error.resourceName).toBe("hubspot");
    }
  });

  it("create: T01 — a broker resolution failure still fails loud with secret_not_resolvable, never fabricating a value", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network when the broker denies");
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({ ok: false as const, error: "denied" })),
    };
    const writer = createConnectorsWriter(BASE_URL, resolver);
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      auth: { authType: "bearer", bearerToken: { secretRef: "hubspot-key" } },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
    }
  });

  it("create: T01 — resolves a bearer auth.bearerToken.secretRef via the broker and maps it into authConfig.bearerToken", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "conn-bearer-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({
        ok: true as const,
        value: "real-bearer-token",
      })),
    };
    const writer = createConnectorsWriter(BASE_URL, resolver);
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      auth: { authType: "bearer", bearerToken: { secretRef: "hubspot-key" } },
    };

    const result = await writer.create("tenant-a", connector, {
      correlationId: "run-1",
    });
    expect(result.ok).toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      kind: "connector",
      owner: "hubspot",
      secretName: "hubspot-key",
      correlationId: "run-1",
    });
    expect(capturedBody).toMatchObject({
      authType: "bearer",
      authConfig: { bearerToken: "real-bearer-token" },
    });
  });

  it("create: T01 — resolves an api-key auth.apiKey.secretRef via the broker, carrying the plain apiKeyHeader through", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "conn-apikey-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({
        ok: true as const,
        value: "real-api-key",
      })),
    };
    const writer = createConnectorsWriter(BASE_URL, resolver);
    const connector: Connector = {
      name: "acme",
      type: "http",
      config: { baseUrl: "https://acme.example.com" },
      auth: {
        authType: "api-key",
        apiKey: { secretRef: "acme-key" },
        apiKeyHeader: "X-Acme-Key",
      },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(true);
    expect(capturedBody).toMatchObject({
      authType: "api-key",
      authConfig: { apiKey: "real-api-key", apiKeyHeader: "X-Acme-Key" },
    });
  });

  it("create: T01 — resolves BOTH basic auth secretRefs via the broker and maps them into authConfig", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "conn-basic-1" }, 201);
    }) as unknown as typeof fetch;

    const resolve = mock(async (args: { secretName: string }) => ({
      ok: true as const,
      value: `resolved-${args.secretName}`,
    }));
    const writer = createConnectorsWriter(BASE_URL, { resolve });
    const connector: Connector = {
      name: "legacy-crm",
      type: "http",
      config: { baseUrl: "https://legacy-crm.example.com" },
      auth: {
        authType: "basic",
        basicUsername: { secretRef: "crm-user" },
        basicPassword: { secretRef: "crm-pass" },
      },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(capturedBody).toMatchObject({
      authType: "basic",
      authConfig: {
        basicUsername: "resolved-crm-user",
        basicPassword: "resolved-crm-pass",
      },
    });
  });

  it("create: T01 — a connector without auth never calls the resolver and omits authType/authConfig", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "conn-noauth-1" }, 201);
    }) as unknown as typeof fetch;

    const resolve = mock(async () => ({ ok: true as const, value: "unused" }));
    const writer = createConnectorsWriter(BASE_URL, { resolve });
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(capturedBody).not.toHaveProperty("authType");
    expect(capturedBody).not.toHaveProperty("authConfig");
  });

  it("create: fails loud with a typed error when config.baseUrl is missing", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network without a baseUrl");
    }) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = { name: "no-url", type: "http" };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_required_field");
    }
  });

  it("create: config.baseUrl present -> POST /connectors", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "conn-1" }, 201)
    ) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("conn-1");
    }
  });

  it("update: existence-only kind — never exercised, safe no-op", async () => {
    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = { name: "hubspot", type: "http" };
    const result = await writer.update("tenant-a", "conn-1", connector, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("conn-1");
    }
  });
});
