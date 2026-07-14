import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ICachedHttpResponseEntry,
  IHttpResponseCache,
} from "../../src/activities/_shared/http-cache/http-response-cache";

// Mirrors `endpoint-call.activity.spec.ts`'s mocking pattern so the pure
// core lib is exercised through the same real breaker/cache/adapter-client
// wiring it will run under in production — only the network edges (Redis,
// fetch) are faked.
const fakeAdapterConfig = {
  id: "adp-1",
  tenantId: "t1",
  name: "Test",
  context: "test",
  baseUrl: "https://api.example.com",
  authType: "api-key",
  authConfig: { apiKey: "secret-key", apiKeyHeader: "X-API-Key" },
  headers: [{ key: "X-Custom", value: "yes" }],
  timeoutMs: 5000,
  maxRetries: 1,
  retryBackoffMs: 10,
  healthCheckPath: "/health",
  status: "enabled",
  defaultCache: {
    enabled: true,
    ttlSeconds: 30,
    methods: ["GET"],
  },
  endpoints: [
    {
      id: "ep-1",
      adapterId: "adp-1",
      label: "Get",
      method: "GET",
      path: "/data",
      cache: {
        enabled: true,
        ttlSeconds: 45,
        methods: ["GET"],
      },
    },
  ],
};

const cachedAdapterEntry = JSON.stringify({
  data: fakeAdapterConfig,
  softExpiresAt: Date.now() + 120_000,
});

// Stateful store (unlike the activity spec's always-null store) so we can
// exercise a real miss-then-hit cache cycle for the httpcache:v1:* keys.
const redisStore = new Map<string, string>();

const mockRedisInstance = {
  get: mock((key: string) => {
    if (key.startsWith("adapter:config:")) {
      return Promise.resolve(cachedAdapterEntry);
    }
    return Promise.resolve(redisStore.get(key) ?? null);
  }),
  setex: mock((key: string, _ttl: number, value: string) => {
    redisStore.set(key, value);
    return Promise.resolve("OK");
  }),
  del: mock((..._keys: string[]) => Promise.resolve(0)),
  script: mock(() => Promise.resolve("sha-fake")),
  evalsha: mock(() => Promise.resolve(["allow", "closed", ""])),
  eval: mock(() => Promise.resolve(["allow", "closed", ""])),
  options: {},
  status: "ready",
};

mock.module("ioredis", () => {
  return {
    default: class Redis {
      constructor() {
        return mockRedisInstance;
      }
    },
  };
});

let tracedFetchMock: ReturnType<typeof mock>;

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
  class FakeLogger {
    log() {}
    warn() {}
    error() {}
  }
  return {
    tracedFetch: tracedFetchMock,
    PinoLoggerService: FakeLogger,
    getMeter: () => ({
      createCounter: () => ({ add() {} }),
      createHistogram: () => ({ record() {} }),
    }),
    startNatsProducerSpan: () => ({ span: { end() {} } }),
    startNatsConsumerSpan: () => ({ span: { end() {} } }),
    injectTraceContext: () => {},
    activeOrRandomTraceId: () => "trace-1",
    logWithEnvelope: () => {},
    createCircuitBreakerMetrics: () => ({
      recordDecision() {},
      recordTransition() {},
      recordL1Hit() {},
      recordRedisError() {},
      recordDecideDuration() {},
    }),
  };
});

const { executeEndpointCallCore } = await import(
  "../../src/lib/endpoint-call-core"
);
const { resolveHttpResponseCachePolicy } = await import(
  "../../src/activities/_shared/http-cache/cache-policy"
);

describe("executeEndpointCallCore", () => {
  beforeEach(() => {
    redisStore.clear();
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ result: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  it("returns ok() with a cache MISS on the first call for a cacheable adapter+endpoint GET", async () => {
    const result = await executeEndpointCallCore(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      "t-miss"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.status).toBe(200);
    expect(result.value.cacheResult).toBe("miss");
    expect(tracedFetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok() with a cache HIT when a matching entry is already stored", async () => {
    // Fresh, isolated in-memory cache injected via `executeEndpointCallCore`'s
    // `httpResponseCache` param (`execute-endpoint-call-core.ts`) instead of
    // touching the `getHttpResponseCache()` process-wide singleton — avoids
    // depending on Bun's cross-spec-file `ioredis` mock race entirely, and
    // needs no cleanup since nothing shared is mutated.
    const memoryCache = new Map<string, ICachedHttpResponseEntry>();
    const isolatedHttpResponseCache: IHttpResponseCache = {
      get: (key) => Promise.resolve(memoryCache.get(key) ?? null),
      setex: (key, _ttl, entry) => {
        memoryCache.set(key, entry);
        return Promise.resolve();
      },
    };

    const tenantId = "t-hit";
    const resolvedUrl = "https://api.example.com/data"; // adapter baseUrl + endpoint path (ep-1)
    const decision = resolveHttpResponseCachePolicy({
      enabled: true,
      strategy: fakeAdapterConfig.endpoints[0]!.cache,
      tenantId,
      method: "GET",
      url: resolvedUrl,
      headers: {},
    });
    expect(decision.policy).not.toBeNull();

    const cachedBody = JSON.stringify({ cached: true });
    await isolatedHttpResponseCache.setex(
      decision.policy!.key,
      decision.policy!.ttlSeconds,
      {
        status: 200,
        bodyBase64: Buffer.from(cachedBody).toString("base64"),
        headers: { "content-type": "application/json" },
        storedAtMs: Date.now(),
      }
    );

    const result = await executeEndpointCallCore(
      {
        method: "GET",
        url: "https://fallback.example.com",
        adapterId: "adp-1",
        endpointId: "ep-1",
      },
      tenantId,
      undefined,
      undefined,
      isolatedHttpResponseCache
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.cacheResult).toBe("hit");
    expect(result.value.data).toEqual({ cached: true });
    // Served entirely from cache — no network call.
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });

  it("returns err({ kind: 'breaker_open' }) when the breaker denies, without any HTTP call", async () => {
    mockRedisInstance.evalsha.mockImplementationOnce(() =>
      Promise.resolve(["deny", "open", "cooldown"])
    );

    const result = await executeEndpointCallCore(
      { method: "GET", url: "https://cb-target.example.com/x" },
      "t-cb"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.kind).toBe("breaker_open");
    if (result.error.kind !== "breaker_open") {
      throw new Error("wrong kind");
    }
    expect(result.error.status).toBe("open");
    expect(result.error.reason).toBe("cooldown");
    expect(result.error.cooldownMs).toBeGreaterThan(0);
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });

  it("returns err({ kind: 'http_error' }) when the upstream call fails after retries", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.reject(new Error("network unreachable"))
    );

    const result = await executeEndpointCallCore(
      { method: "GET", url: "https://raw.example.com/api" },
      "t-http-err"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.kind).toBe("http_error");
    if (result.error.kind !== "http_error") {
      throw new Error("wrong kind");
    }
    expect(result.error.message).toContain("network unreachable");
    expect(result.error.cause).toBeInstanceOf(Error);
  });

  it("returns err({ kind: 'invalid_args' }) for a relative raw URL without adapterId", async () => {
    const result = await executeEndpointCallCore(
      { method: "GET", url: "/relative" },
      "t-invalid"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.kind).toBe("invalid_args");
    if (result.error.kind !== "invalid_args") {
      throw new Error("wrong kind");
    }
    expect(result.error.code).toBe("INVALID_ENDPOINT_CALL_URL");
    expect(tracedFetchMock).not.toHaveBeenCalled();
  });
});
