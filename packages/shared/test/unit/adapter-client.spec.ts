import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { AdapterCache, AdapterConfig } from "../../src/adapter.interfaces";
import { AdapterClient } from "../../src/adapter-client";

function makeAdapter(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    id: "adp-1",
    tenantId: "t1",
    name: "Test Adapter",
    context: "test",
    baseUrl: "https://api.example.com",
    authType: "none",
    authConfig: {},
    headers: [{ key: "X-Custom", value: "yes" }],
    timeoutMs: 5000,
    maxRetries: 2,
    retryBackoffMs: 200,
    healthCheckPath: "/health",
    status: "active",
    endpoints: [
      {
        id: "ep-1",
        adapterId: "adp-1",
        label: "Get Data",
        method: "GET",
        path: "/data",
      },
      {
        id: "ep-2",
        adapterId: "adp-1",
        label: "Post Data",
        method: "POST",
        path: "ingest",
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AdapterClient", () => {
  let cache: AdapterCache & {
    get: ReturnType<typeof mock>;
    setex: ReturnType<typeof mock>;
    del: ReturnType<typeof mock>;
  };
  let fetchFn: ReturnType<typeof mock>;
  let client: AdapterClient;

  const adapter = makeAdapter();

  beforeEach(() => {
    cache = {
      get: mock(() => Promise.resolve(null)),
      setex: mock(() => Promise.resolve("OK")),
      del: mock((..._keys: string[]) => Promise.resolve(0)),
    };
    fetchFn = mock(() => Promise.resolve(jsonResponse(adapter)));
    client = new AdapterClient({
      baseUrl: "http://adapter-svc",
      fetchFn: fetchFn as unknown as typeof globalThis.fetch,
      cache,
      cacheTtlSeconds: 10,
    });
  });

  describe("getAdapter", () => {
    it("should fetch and cache on cache miss", async () => {
      const result = await client.getAdapter("t1", "adp-1");

      expect(result.id).toBe("adp-1");
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(cache.setex).toHaveBeenCalledTimes(1);

      const [key, ttl] = cache.setex.mock.calls[0];
      expect(key).toBe("adapter:config:t1:adp-1");
      expect(ttl).toBe(50);
    });

    it("should return cached data when soft TTL is fresh", async () => {
      const entry = {
        data: adapter,
        softExpiresAt: Date.now() + 60_000,
      };
      cache.get = mock(() => Promise.resolve(JSON.stringify(entry)));

      const result = await client.getAdapter("t1", "adp-1");

      expect(result.id).toBe("adp-1");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("should refresh when soft TTL expired and service is reachable", async () => {
      const staleEntry = {
        data: makeAdapter({ name: "Stale" }),
        softExpiresAt: Date.now() - 1_000,
      };
      cache.get = mock(() => Promise.resolve(JSON.stringify(staleEntry)));

      const result = await client.getAdapter("t1", "adp-1");

      expect(result.name).toBe("Test Adapter");
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(cache.setex).toHaveBeenCalledTimes(1);
    });

    it("should return stale data when refresh fails", async () => {
      const staleEntry = {
        data: makeAdapter({ name: "Stale" }),
        softExpiresAt: Date.now() - 1_000,
      };
      cache.get = mock(() => Promise.resolve(JSON.stringify(staleEntry)));
      fetchFn = mock(() => Promise.resolve(jsonResponse({}, 500)));
      client = new AdapterClient({
        baseUrl: "http://adapter-svc",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        cache,
        cacheTtlSeconds: 10,
      });

      const result = await client.getAdapter("t1", "adp-1");

      expect(result.name).toBe("Stale");
    });
  });

  describe("resolveRequest", () => {
    it("should build URL, merge headers, and return config", async () => {
      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");

      expect(resolved.url).toBe("https://api.example.com/data");
      expect(resolved.method).toBe("GET");
      expect(resolved.headers["X-Custom"]).toBe("yes");
      expect(resolved.timeoutMs).toBe(5000);
      expect(resolved.maxRetries).toBe(2);
      expect(resolved.retryBackoffMs).toBe(200);
    });

    it("should prepend slash to endpoint path if missing", async () => {
      const resolved = await client.resolveRequest("t1", "adp-1", "ep-2");
      expect(resolved.url).toBe("https://api.example.com/ingest");
    });

    it("should throw for unknown endpoint", async () => {
      await expect(
        client.resolveRequest("t1", "adp-1", "nonexistent"),
      ).rejects.toThrow("Endpoint 'nonexistent' not found on adapter 'adp-1'");
    });
  });

  describe("auth injection", () => {
    it("should add no auth header for type 'none'", async () => {
      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");
      expect(resolved.headers["Authorization"]).toBeUndefined();
    });

    it("should set api-key header", async () => {
      fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse(
            makeAdapter({
              authType: "api-key",
              authConfig: { apiKey: "secret-123", apiKeyHeader: "X-My-Key" },
            }),
          ),
        ),
      );
      client = new AdapterClient({
        baseUrl: "http://adapter-svc",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        cache,
        cacheTtlSeconds: 10,
      });

      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");
      expect(resolved.headers["X-My-Key"]).toBe("secret-123");
    });

    it("should set Bearer auth header", async () => {
      fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse(
            makeAdapter({
              authType: "bearer",
              authConfig: { bearerToken: "tok-abc" },
            }),
          ),
        ),
      );
      client = new AdapterClient({
        baseUrl: "http://adapter-svc",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        cache,
        cacheTtlSeconds: 10,
      });

      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");
      expect(resolved.headers["Authorization"]).toBe("Bearer tok-abc");
    });

    it("should set Basic auth header", async () => {
      fetchFn = mock(() =>
        Promise.resolve(
          jsonResponse(
            makeAdapter({
              authType: "basic",
              authConfig: { basicUsername: "user", basicPassword: "pass" },
            }),
          ),
        ),
      );
      client = new AdapterClient({
        baseUrl: "http://adapter-svc",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        cache,
        cacheTtlSeconds: 10,
      });

      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");
      expect(resolved.headers["Authorization"]).toBe(
        `Basic ${btoa("user:pass")}`,
      );
    });

    it("should fetch and cache OAuth2 token", async () => {
      const oauthAdapter = makeAdapter({
        authType: "oauth2",
        authConfig: {
          oauth2TokenUrl: "https://auth.example.com/token",
          oauth2ClientId: "cid",
          oauth2ClientSecret: "csecret",
        },
      });

      let callCount = 0;
      fetchFn = mock((url: string) => {
        callCount++;
        if (url.includes("/token")) {
          return Promise.resolve(
            jsonResponse({ access_token: "atok-1", expires_in: 3600 }),
          );
        }
        return Promise.resolve(jsonResponse(oauthAdapter));
      });
      client = new AdapterClient({
        baseUrl: "http://adapter-svc",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        cache,
        cacheTtlSeconds: 10,
      });

      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");
      expect(resolved.headers["Authorization"]).toBe("Bearer atok-1");

      const oauthSetex = cache.setex.mock.calls.find(
        (c: unknown[]) => (c[0] as string).startsWith("adapter:oauth:"),
      );
      expect(oauthSetex).toBeDefined();
      expect(oauthSetex![1]).toBe(3570);
      expect(oauthSetex![2]).toBe("atok-1");
    });

    it("should return cached OAuth2 token without re-fetching", async () => {
      const oauthAdapter = makeAdapter({
        authType: "oauth2",
        authConfig: {
          oauth2TokenUrl: "https://auth.example.com/token",
          oauth2ClientId: "cid",
          oauth2ClientSecret: "csecret",
        },
      });

      cache.get = mock((key: string) => {
        if (key.startsWith("adapter:oauth:")) return Promise.resolve("cached-tok");
        return Promise.resolve(null);
      });
      fetchFn = mock(() => Promise.resolve(jsonResponse(oauthAdapter)));
      client = new AdapterClient({
        baseUrl: "http://adapter-svc",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        cache,
        cacheTtlSeconds: 10,
      });

      const resolved = await client.resolveRequest("t1", "adp-1", "ep-1");
      expect(resolved.headers["Authorization"]).toBe("Bearer cached-tok");

      const tokenFetchCalls = fetchFn.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes("/token"),
      );
      expect(tokenFetchCalls.length).toBe(0);
    });
  });

  describe("invalidate", () => {
    it("should call cache.del with the correct key", async () => {
      await client.invalidate("t1", "adp-1");
      expect(cache.del).toHaveBeenCalledWith("adapter:config:t1:adp-1");
    });
  });

  describe("invalidateOAuthToken", () => {
    it("should call cache.del with the OAuth key", async () => {
      await client.invalidateOAuthToken("adp-1");
      expect(cache.del).toHaveBeenCalledWith("adapter:oauth:adp-1");
    });
  });
});
