import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ManifestMcpServer } from "@yoizen/shared";
import { createMcpServersWriter } from "../../../src/modules/apply/infrastructure/mcp-servers-writer";

const BASE_URL = "http://agent-admin-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createMcpServersWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: refuses an mcpServer with an auth.token.secretRef when NO broker resolver is wired — never fabricates auth material", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error(
        "must never call the network for a secretRef'd mcpServer"
      );
    }) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "github-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      auth: { authType: "bearer", token: { secretRef: "github-token" } },
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
      expect(result.error.resourceKind).toBe("mcpServer");
      expect(result.error.resourceName).toBe("github-mcp");
    }
  });

  it("create: a broker resolution failure still fails loud with secret_not_resolvable, never fabricating a value", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network when the broker denies");
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({ ok: false as const, error: "denied" })),
    };
    const writer = createMcpServersWriter(BASE_URL, resolver);
    const mcpServer: ManifestMcpServer = {
      name: "github-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      auth: { authType: "bearer", token: { secretRef: "github-token" } },
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
    }
  });

  it("create: resolves a bearer auth.token.secretRef via the broker and maps it into authConfig.token", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "mcp-bearer-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({
        ok: true as const,
        value: "real-bearer-token",
      })),
    };
    const writer = createMcpServersWriter(BASE_URL, resolver);
    const mcpServer: ManifestMcpServer = {
      name: "github-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      auth: { authType: "bearer", token: { secretRef: "github-token" } },
    };

    const result = await writer.create("tenant-a", mcpServer, {
      correlationId: "run-1",
    });
    expect(result.ok).toBe(true);
    expect(resolver.resolve).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      kind: "mcpServer",
      owner: "github-mcp",
      secretName: "github-token",
      correlationId: "run-1",
    });
    expect(capturedBody).toMatchObject({
      authType: "bearer",
      authConfig: { token: "real-bearer-token" },
    });
    // Plaintext secret NEVER appears anywhere in the serialized request body
    // except the resolved field itself.
    expect(JSON.stringify(capturedBody)).not.toContain("github-token");
  });

  it("create: resolves an api-key auth.key.secretRef via the broker, carrying the plain headerName through", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "mcp-apikey-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => ({ ok: true as const, value: "real-api-key" })),
    };
    const writer = createMcpServersWriter(BASE_URL, resolver);
    const mcpServer: ManifestMcpServer = {
      name: "deepwiki-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      auth: {
        authType: "api-key",
        key: { secretRef: "deepwiki-key" },
        headerName: "X-Api-Key",
      },
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(true);
    expect(capturedBody).toMatchObject({
      authType: "api-key",
      authConfig: { key: "real-api-key", headerName: "X-Api-Key" },
    });
  });

  it("create: resolves BOTH basic auth secretRefs via the broker and maps them into authConfig", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "mcp-basic-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async ({ secretName }: { secretName: string }) => ({
        ok: true as const,
        value: secretName === "u" ? "real-user" : "real-pass",
      })),
    };
    const writer = createMcpServersWriter(BASE_URL, resolver);
    const mcpServer: ManifestMcpServer = {
      name: "basic-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
      auth: {
        authType: "basic",
        username: { secretRef: "u" },
        password: { secretRef: "p" },
      },
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(true);
    expect(capturedBody).toMatchObject({
      authType: "basic",
      authConfig: { username: "real-user", password: "real-pass" },
    });
  });

  it("create: an mcpServer without auth never calls the resolver and omits authType/authConfig", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "mcp-noauth-1" }, 201);
    }) as unknown as typeof fetch;

    const resolver = {
      resolve: mock(async () => {
        throw new Error("must never be called for an mcpServer with no auth");
      }),
    };
    const writer = createMcpServersWriter(BASE_URL, resolver);
    const mcpServer: ManifestMcpServer = {
      name: "no-auth-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(true);
    expect(capturedBody).not.toHaveProperty("authType");
    expect(capturedBody).not.toHaveProperty("authConfig");
  });

  describe("headers (T06)", () => {
    it("create: a plain string header value is sent verbatim, never treated as a secret", async () => {
      let capturedBody: unknown;
      globalThis.fetch = mock(async (_url, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return json({ id: "mcp-header-1" }, 201);
      }) as unknown as typeof fetch;

      const resolver = {
        resolve: mock(async () => {
          throw new Error("must never be called for a plain string header");
        }),
      };
      const writer = createMcpServersWriter(BASE_URL, resolver);
      const mcpServer: ManifestMcpServer = {
        name: "header-mcp",
        transport_type: "http",
        url: "https://mcp.example.com",
        headers: { "X-Request-Source": "manifest" },
      };

      const result = await writer.create("tenant-a", mcpServer);
      expect(result.ok).toBe(true);
      expect(capturedBody).toMatchObject({
        headers: { "X-Request-Source": "manifest" },
      });
    });

    it("create: a { secretRef } header value is resolved through the broker, never the literal ref object", async () => {
      let capturedBody: unknown;
      globalThis.fetch = mock(async (_url, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return json({ id: "mcp-header-2" }, 201);
      }) as unknown as typeof fetch;

      const resolver = {
        resolve: mock(async () => ({
          ok: true as const,
          value: "PLAINTEXT-CREDENTIAL-VALUE",
        })),
      };
      const writer = createMcpServersWriter(BASE_URL, resolver);
      const mcpServer: ManifestMcpServer = {
        name: "header-secret-mcp",
        transport_type: "http",
        url: "https://mcp.example.com",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": {
            secretRef: "telegram-secret",
          },
        },
      };

      const result = await writer.create("tenant-a", mcpServer);
      expect(result.ok).toBe(true);
      expect(resolver.resolve).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        kind: "mcpServer",
        owner: "header-secret-mcp",
        secretName: "telegram-secret",
        correlationId: undefined,
      });
      expect(capturedBody).toMatchObject({
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "PLAINTEXT-CREDENTIAL-VALUE",
        },
      });
      // The nested `{ secretRef }` ref-object shape itself is gone from the
      // outgoing body — only the RESOLVED value is present (never the raw
      // secretRef targeting object).
      expect(capturedBody).not.toHaveProperty(
        "headers.X-Telegram-Bot-Api-Secret-Token.secretRef"
      );
    });

    it("create: a header secretRef resolution failure fails loud with secret_not_resolvable", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error(
          "must never call the network on header resolve failure"
        );
      }) as unknown as typeof fetch;

      const resolver = {
        resolve: mock(async () => ({ ok: false as const, error: "denied" })),
      };
      const writer = createMcpServersWriter(BASE_URL, resolver);
      const mcpServer: ManifestMcpServer = {
        name: "header-fail-mcp",
        transport_type: "http",
        url: "https://mcp.example.com",
        headers: { "X-Custom": { secretRef: "missing-secret" } },
      };

      const result = await writer.create("tenant-a", mcpServer);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("secret_not_resolvable");
      }
    });
  });

  it("create: POSTs name/transport_type/url (+ description/enabled/scope when present)", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "mcp-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "full-mcp",
      description: "Full-featured MCP server",
      transport_type: "sse",
      url: "https://mcp.example.com/sse",
      enabled: false,
      scope: "internal",
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe(`${BASE_URL}/admin/mcp-servers`);
    expect(capturedBody).toEqual({
      name: "full-mcp",
      description: "Full-featured MCP server",
      transport_type: "sse",
      url: "https://mcp.example.com/sse",
      enabled: false,
      scope: "internal",
    });
  });

  it("create: a network failure fails loud with a typed downstream_error, never fabricating an externalId", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "network-fail-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.resourceKind).toBe("mcpServer");
    }
  });

  it("create: a non-2xx HTTP response fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () =>
      json({ message: "conflict" }, 409)
    ) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "conflict-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });

  it("create: malformed JSON in the create response fails loud with a typed downstream_error (never throws)", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("not json", {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "malformed-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
    };

    const result = await writer.create("tenant-a", mcpServer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });

  it("update: PATCHes /admin/mcp-servers/:id with the full desired body", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method as string;
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "mcp-1" }, 200);
    }) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "full-mcp",
      transport_type: "http",
      url: "https://mcp.example.com/v2",
      enabled: true,
    };

    const result = await writer.update("tenant-a", "mcp-1", mcpServer, [
      {
        field: "url",
        current: "https://mcp.example.com",
        desired: "https://mcp.example.com/v2",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe("PATCH");
    expect(capturedUrl).toBe(`${BASE_URL}/admin/mcp-servers/mcp-1`);
    expect(capturedBody).toMatchObject({
      url: "https://mcp.example.com/v2",
      enabled: true,
    });
  });

  it("update: a network failure fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const writer = createMcpServersWriter(BASE_URL);
    const mcpServer: ManifestMcpServer = {
      name: "full-mcp",
      transport_type: "http",
      url: "https://mcp.example.com",
    };

    const result = await writer.update("tenant-a", "mcp-1", mcpServer, [
      { field: "url", current: "old", desired: "new" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });
});
