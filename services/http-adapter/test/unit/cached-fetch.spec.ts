import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("@yoizen/observability", () => ({
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
  }),
  tracedFetch: mock(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ),
  PinoLoggerService: class FakeLogger {
    log() {}
    warn() {}
    error() {}
  },
  createCircuitBreakerMetrics: () => ({
    recordDecision() {},
    recordTransition() {},
    recordL1Hit() {},
    recordRedisError() {},
    recordDecideDuration() {},
  }),
}));

const { cachedFetch } = await import(
  "../../src/activities/_shared/http-cache/cached-fetch"
);
const { HttpResponseCacheReason } = await import(
  "../../src/activities/_shared/metrics"
);

describe("cachedFetch", () => {
  const cache = {
    get: mock(async () => null),
    setex: mock(async () => undefined),
  };
  const fetchFn = mock(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  beforeEach(() => {
    cache.get.mockReset();
    cache.get.mockImplementation(async () => null);
    cache.setex.mockReset();
    cache.setex.mockImplementation(async () => undefined);
    fetchFn.mockReset();
    fetchFn.mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("passes through when the decision has no cache policy", async () => {
    const response = await cachedFetch(
      "https://example.com/items",
      { method: "GET" },
      {
        decision: {
          method: "GET",
          policy: null,
          reason: HttpResponseCacheReason.UNSUPPORTED_TARGET,
        },
        cache,
        fetchFn,
      },
    );

    expect(cache.get).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("serves a cache hit without calling upstream", async () => {
    cache.get.mockImplementation(async () => ({
      status: 200,
      bodyBase64: Buffer.from(JSON.stringify({ cached: true })).toString(
        "base64",
      ),
      headers: { "content-type": "application/json" },
      storedAtMs: Date.now(),
    }));

    const response = await cachedFetch(
      "https://example.com/items",
      { method: "GET" },
      {
        decision: {
          method: "GET",
          policy: { key: "httpcache:v1:hit", ttlSeconds: 60 },
          reason: HttpResponseCacheReason.OK,
        },
        cache,
        fetchFn,
      },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ cached: true });
  });

  it("stores successful misses in Redis", async () => {
    const response = await cachedFetch(
      "https://example.com/items",
      { method: "GET" },
      {
        decision: {
          method: "GET",
          policy: { key: "httpcache:v1:miss", ttlSeconds: 90 },
          reason: HttpResponseCacheReason.OK,
        },
        cache,
        fetchFn,
      },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cache.setex).toHaveBeenCalledTimes(1);
    const [key, ttl, entry] = cache.setex.mock.calls[0]!;
    expect(key).toBe("httpcache:v1:miss");
    expect(ttl).toBe(90);
    expect(entry.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("does not store non-success responses", async () => {
    fetchFn.mockImplementation(async () =>
      new Response(JSON.stringify({ error: true }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await cachedFetch(
      "https://example.com/items",
      { method: "GET" },
      {
        decision: {
          method: "GET",
          policy: { key: "httpcache:v1:error", ttlSeconds: 30 },
          reason: HttpResponseCacheReason.OK,
        },
        cache,
        fetchFn,
      },
    );

    expect(cache.setex).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: true });
  });

  it("falls back to upstream when Redis read fails", async () => {
    cache.get.mockImplementation(async () => {
      throw new Error("redis down");
    });

    const response = await cachedFetch(
      "https://example.com/items",
      { method: "GET" },
      {
        decision: {
          method: "GET",
          policy: { key: "httpcache:v1:fallback", ttlSeconds: 30 },
          reason: HttpResponseCacheReason.OK,
        },
        cache,
        fetchFn,
      },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ ok: true });
  });
});
