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

  it("update: a connector with no declared endpoints is a safe no-op (never calls the network)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network with no endpoints declared");
    }) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = { name: "hubspot", type: "http" };
    const result = await writer.update("tenant-a", "conn-1", connector, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("conn-1");
    }
  });

  // T02 (manual-loops/provisioning-manifest-gaps.md, gap 2): endpoint
  // reconciliation on create/update, via connector-admin's dedicated
  // endpoint API (POST .../endpoints, PATCH .../endpoints/:epId).
  describe("endpoints (T02)", () => {
    it("create: reconciles declared endpoints AFTER the connector is created, in declaration order", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        if (init.method === "POST" && url.endsWith("/connectors")) {
          return json({ id: "conn-1" }, 201);
        }
        return json({ id: "ep-x" }, 201);
      }) as unknown as typeof fetch;

      const writer = createConnectorsWriter(BASE_URL);
      const connector: Connector = {
        name: "hubspot",
        type: "http",
        config: { baseUrl: "https://hubspot.example.com" },
        endpoints: [
          { label: "list-contacts", method: "GET", path: "/contacts" },
          { label: "create-contact", method: "POST", path: "/contacts" },
        ],
      };

      const result = await writer.create("tenant-a", connector);
      expect(result.ok).toBe(true);

      // Call 0 creates the connector itself; calls 1-2 are the endpoints,
      // in the SAME order as declared in the manifest.
      expect(calls).toHaveLength(3);
      expect(calls[0].url).toBe(`${BASE_URL}/connectors`);
      expect(calls[1].url).toBe(`${BASE_URL}/connectors/conn-1/endpoints`);
      expect(calls[1].method).toBe("POST");
      expect(calls[1].body).toMatchObject({
        label: "list-contacts",
        method: "GET",
        path: "/contacts",
      });
      expect(calls[2].url).toBe(`${BASE_URL}/connectors/conn-1/endpoints`);
      expect(calls[2].body).toMatchObject({
        label: "create-contact",
        method: "POST",
        path: "/contacts",
      });
    });

    it("create: fails loud with a typed downstream_error naming the connector AND the endpoint on an endpoint API failure", async () => {
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        if (init.method === "POST" && url.endsWith("/connectors")) {
          return json({ id: "conn-1" }, 201);
        }
        return json({ message: "boom" }, 500);
      }) as unknown as typeof fetch;

      const writer = createConnectorsWriter(BASE_URL);
      const connector: Connector = {
        name: "hubspot",
        type: "http",
        config: { baseUrl: "https://hubspot.example.com" },
        endpoints: [
          { label: "list-contacts", method: "GET", path: "/contacts" },
        ],
      };

      const result = await writer.create("tenant-a", connector);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.resourceName).toBe("hubspot");
        expect(result.error.message).toContain("hubspot");
        expect(result.error.message).toContain("list-contacts");
      }
    });

    it("update: fetches live endpoints, then ADDS a new declared endpoint absent live", async () => {
      const calls: { url: string; method: string; body?: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        if (init.method === "GET") {
          return json({ id: "conn-1", name: "hubspot", endpoints: [] });
        }
        return json({ id: "ep-1" }, 201);
      }) as unknown as typeof fetch;

      const writer = createConnectorsWriter(BASE_URL);
      const connector: Connector = {
        name: "hubspot",
        type: "http",
        endpoints: [
          { label: "list-contacts", method: "GET", path: "/contacts" },
        ],
      };

      const result = await writer.update("tenant-a", "conn-1", connector, [
        { field: "endpoints" },
      ]);
      expect(result.ok).toBe(true);

      expect(calls[0].method).toBe("GET");
      expect(calls[0].url).toBe(`${BASE_URL}/connectors/conn-1`);
      expect(calls[1].method).toBe("POST");
      expect(calls[1].url).toBe(`${BASE_URL}/connectors/conn-1/endpoints`);
    });

    it("update: matches an existing endpoint by (method, path) and PATCHes it instead of creating a duplicate", async () => {
      const calls: { url: string; method: string; body?: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        if (init.method === "GET") {
          return json({
            id: "conn-1",
            name: "hubspot",
            endpoints: [
              {
                id: "ep-existing",
                adapterId: "conn-1",
                label: "old-label",
                method: "get",
                path: "/contacts",
                cache: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return json({ id: "ep-existing" }, 200);
      }) as unknown as typeof fetch;

      const writer = createConnectorsWriter(BASE_URL);
      const connector: Connector = {
        name: "hubspot",
        type: "http",
        endpoints: [
          { label: "list-contacts", method: "GET", path: "/contacts" },
        ],
      };

      const result = await writer.update("tenant-a", "conn-1", connector, [
        { field: "endpoints" },
      ]);
      expect(result.ok).toBe(true);

      const endpointCall = calls[1];
      expect(endpointCall.method).toBe("PATCH");
      expect(endpointCall.url).toBe(
        `${BASE_URL}/connectors/conn-1/endpoints/ep-existing`
      );
      expect(endpointCall.body).toMatchObject({
        label: "list-contacts",
        method: "GET",
        path: "/contacts",
      });
    });

    it("update: never issues a DELETE — an endpoint present live but absent from the manifest is left untouched (decision 2, no prune)", async () => {
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        if (init.method === "DELETE") {
          throw new Error("must never delete an endpoint");
        }
        if (init.method === "GET") {
          return json({
            id: "conn-1",
            name: "hubspot",
            endpoints: [
              {
                id: "ep-untouched",
                adapterId: "conn-1",
                label: "legacy-endpoint",
                method: "DELETE",
                path: "/legacy",
                cache: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return json({ id: "ep-new" }, 201);
      }) as unknown as typeof fetch;

      const writer = createConnectorsWriter(BASE_URL);
      const connector: Connector = {
        name: "hubspot",
        type: "http",
        endpoints: [
          { label: "list-contacts", method: "GET", path: "/contacts" },
        ],
      };

      const result = await writer.update("tenant-a", "conn-1", connector, [
        { field: "endpoints" },
      ]);
      expect(result.ok).toBe(true);
    });
  });
});
