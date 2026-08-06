import { beforeEach, describe, expect, it, mock } from "bun:test";
import { setActiveLoggerSink } from "../helpers/fake-traced-fetch";

// `cache-service-store.ts` logs through `PinoLoggerService`
// (`@yoizen/observability`). That module is doubled ONCE for the whole
// process by the shared `test/helpers/fake-traced-fetch` helper — a private
// `mock.module("@yoizen/observability", ...)` here would lose the binding
// race against every other spec file (see that helper's header). Log
// assertions therefore go through its `setActiveLoggerSink` indirection.
//
// The store's HTTP edge is injected per-test (`fetchFn`), so nothing here
// touches the real network or the shared `tracedFetch` cell.
const warnCalls: string[] = [];
const debugCalls: string[] = [];
const logCalls: string[] = [];

const { createCacheServiceAdapterCache } = await import(
  "../../src/activities/_shared/http-cache/cache-service-store"
);

const BASE_URL = "http://cache-service.platform-services-dev.svc.cluster.local";
const KEY = "httpcache:v1:abc123";
const ENCODED_KEY = encodeURIComponent(KEY);

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

describe("createCacheServiceAdapterCache", () => {
  const fetchFn = mock(async () => jsonResponse("null"));

  const store = () =>
    createCacheServiceAdapterCache({
      baseUrl: BASE_URL,
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

  const calls = () => fetchFn.mock.calls as unknown as [string, RequestInit][];

  beforeEach(() => {
    fetchFn.mockReset();
    fetchFn.mockImplementation(async () => jsonResponse("null"));
    warnCalls.length = 0;
    debugCalls.length = 0;
    logCalls.length = 0;
    setActiveLoggerSink({
      log: (m) => logCalls.push(m),
      warn: (m) => warnCalls.push(m),
      debug: (m) => debugCalls.push(m),
      error: (m) => warnCalls.push(m),
    });
  });

  it("logs the bound cache-service URL when the store is created", () => {
    store();
    expect(logCalls.some((m) => m.includes(BASE_URL))).toBe(true);
  });

  describe("get", () => {
    it("returns the stored string on a hit (GET /cache/:key, encoded key)", async () => {
      const entry = JSON.stringify({ status: 200, bodyBase64: "aGk=" });
      fetchFn.mockImplementation(async () =>
        jsonResponse(JSON.stringify(entry))
      );

      const result = await store().get(KEY);

      expect(result).toBe(entry);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = calls()[0]!;
      expect(url).toBe(`${BASE_URL}/cache/${ENCODED_KEY}`);
      expect(init.method).toBe("GET");
      expect(init.signal).toBeDefined();
      expect(warnCalls).toHaveLength(0);
    });

    it("treats the JSON literal null (a miss) as a cache miss", async () => {
      fetchFn.mockImplementation(async () => jsonResponse("null"));

      expect(await store().get(KEY)).toBeNull();
      expect(warnCalls).toHaveLength(0);
      expect(debugCalls.some((m) => m.includes("miss"))).toBe(true);
    });

    it("re-serializes a non-string value written by another writer", async () => {
      fetchFn.mockImplementation(async () => jsonResponse('{"status":200}'));

      expect(await store().get(KEY)).toBe('{"status":200}');
    });

    it("warns and misses on a 5xx from cache-service", async () => {
      fetchFn.mockImplementation(async () => jsonResponse("boom", 503));

      expect(await store().get(KEY)).toBeNull();
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("HTTP 503");
      expect(warnCalls[0]).toContain("cache miss/no-op");
    });

    it("warns and misses when the connection fails (never throws)", async () => {
      fetchFn.mockImplementation(async () => {
        throw new Error("connect ECONNREFUSED");
      });

      expect(await store().get(KEY)).toBeNull();
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("connect ECONNREFUSED");
    });

    it("warns and misses when the timeout aborts the request", async () => {
      fetchFn.mockImplementation(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      });

      expect(await store().get(KEY)).toBeNull();
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("timed out");
    });

    it("warns and misses when the body is not JSON", async () => {
      fetchFn.mockImplementation(
        async () => new Response("<html>gateway</html>", { status: 200 })
      );

      expect(await store().get(KEY)).toBeNull();
      expect(warnCalls).toHaveLength(1);
    });

    it("de-duplicates repeated identical failures", async () => {
      fetchFn.mockImplementation(async () => jsonResponse("boom", 503));

      const cache = store();
      for (let i = 0; i < 10; i++) {
        expect(await cache.get(KEY)).toBeNull();
      }

      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("repeat=1");
    });
  });

  describe("setex", () => {
    it("PUTs the value with the TTL in the body", async () => {
      fetchFn.mockImplementation(async () => jsonResponse('{"ok":true}'));

      await store().setex(KEY, 42, '{"status":200}');

      const [url, init] = calls()[0]!;
      expect(url).toBe(`${BASE_URL}/cache/${ENCODED_KEY}`);
      expect(init.method).toBe("PUT");
      expect(JSON.parse(String(init.body))).toEqual({
        value: '{"status":200}',
        ttl: 42,
      });
      expect(warnCalls).toHaveLength(0);
    });

    it("floors a fractional TTL to an integer >= 1 (cache-service rejects otherwise)", async () => {
      fetchFn.mockImplementation(async () => jsonResponse('{"ok":true}'));

      await store().setex(KEY, 0.4, "v");

      const [, init] = calls()[0]!;
      expect(JSON.parse(String(init.body)).ttl).toBe(1);
    });

    it("warns and no-ops on a cache-service error", async () => {
      fetchFn.mockImplementation(async () => {
        throw new Error("connect ECONNREFUSED");
      });

      expect(await store().setex(KEY, 30, "v")).toBeNull();
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("setex");
    });

    it("warns and no-ops on a 5xx", async () => {
      fetchFn.mockImplementation(async () => jsonResponse("boom", 500));

      expect(await store().setex(KEY, 30, "v")).toBeNull();
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("HTTP 500");
    });
  });

  describe("del", () => {
    it("DELETEs every key and counts the successes", async () => {
      fetchFn.mockImplementation(async () => jsonResponse('{"ok":true}'));

      expect(await store().del(KEY, "httpcache:v1:other")).toBe(2);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      const [url, init] = calls()[0]!;
      expect(url).toBe(`${BASE_URL}/cache/${ENCODED_KEY}`);
      expect(init.method).toBe("DELETE");
    });

    it("warns and no-ops when cache-service is down", async () => {
      fetchFn.mockImplementation(async () => {
        throw new Error("connect ECONNREFUSED");
      });

      expect(await store().del(KEY)).toBe(0);
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]).toContain("del");
    });
  });

  it("strips trailing slashes from the base URL", async () => {
    fetchFn.mockImplementation(async () => jsonResponse("null"));

    await createCacheServiceAdapterCache({
      baseUrl: `${BASE_URL}//`,
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    }).get(KEY);

    const [url] = calls()[0]!;
    expect(url).toBe(`${BASE_URL}/cache/${ENCODED_KEY}`);
  });
});
