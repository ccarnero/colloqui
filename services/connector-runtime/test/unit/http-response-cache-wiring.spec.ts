import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  type FakeRedisInstance,
  setActiveRedisInstance,
} from "../helpers/fake-adapter-redis";
import {
  getFakeCacheServiceRequests,
  getFakeCacheServiceValue,
  resetFakeCacheService,
} from "../helpers/fake-cache-service";
import { setActiveTracedFetch } from "../helpers/fake-traced-fetch";

// Regression test for T11/E36b: `getHttpResponseCache()` — the process-wide
// singleton every endpoint/service call uses — must go through cache-service
// over HTTP, NOT through the raw ioredis client this provider also owns.
// Both edges are the SHARED doubles (`fake-adapter-redis` /
// `fake-traced-fetch`, whose in-memory `fake-cache-service` serves
// `/cache/:key`), so this file can watch BOTH and prove the key namespace
// moved: every `httpcache:v1:*` operation lands on cache-service and NONE of
// them touches Redis.
const redisKeysTouched: string[] = [];

const recordingRedis: FakeRedisInstance = {
  get: (key: string) => {
    redisKeysTouched.push(`get:${key}`);
    return Promise.resolve(null);
  },
  setex: (key: string) => {
    redisKeysTouched.push(`setex:${key}`);
    return Promise.resolve("OK");
  },
  del: (...keys: string[]) => {
    redisKeysTouched.push(`del:${keys.join(",")}`);
    return Promise.resolve(0);
  },
  script: () => Promise.resolve("sha-fake"),
  evalsha: () => Promise.resolve(["allow", "closed", ""]),
  eval: () => Promise.resolve(["allow", "closed", ""]),
  options: {},
  status: "ready",
};

const upstreamFetch = mock(async () => {
  throw new Error("no upstream call expected in this spec");
});

const { getHttpResponseCache } = await import(
  "../../src/activities/_shared/adapter-client.provider"
);
const { workflowHttpWorkerConfig } = await import("../../src/config");

const KEY = "httpcache:v1:wiring";
const ENTRY = {
  status: 200,
  bodyBase64: "aGk=",
  headers: { "content-type": "application/json" },
  storedAtMs: 1,
};

describe("getHttpResponseCache", () => {
  beforeEach(() => {
    setActiveRedisInstance(recordingRedis);
    setActiveTracedFetch(upstreamFetch as never);
    resetFakeCacheService();
    redisKeysTouched.length = 0;
  });

  it("defaults to the configured cache-service URL", () => {
    expect(workflowHttpWorkerConfig.cacheServiceUrl).toContain("cache-service");
  });

  it("writes the entry to cache-service with its TTL, never to Redis", async () => {
    await getHttpResponseCache().setex(KEY, 30, ENTRY);

    const puts = getFakeCacheServiceRequests().filter(
      (r) => r.method === "PUT"
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toBe(KEY);
    expect(puts[0]?.ttl).toBe(30);
    expect(JSON.parse(String(getFakeCacheServiceValue(KEY)))).toEqual(ENTRY);
    expect(redisKeysTouched).toHaveLength(0);
  });

  it("reads the entry back from cache-service (miss then hit), never from Redis", async () => {
    const cache = getHttpResponseCache();

    expect(await cache.get(KEY)).toBeNull();

    await cache.setex(KEY, 30, ENTRY);
    expect(await cache.get(KEY)).toEqual(ENTRY);

    const gets = getFakeCacheServiceRequests().filter(
      (r) => r.method === "GET"
    );
    expect(gets).toHaveLength(2);
    expect(gets.every((r) => r.key === KEY)).toBe(true);
    expect(redisKeysTouched).toHaveLength(0);
  });
});
