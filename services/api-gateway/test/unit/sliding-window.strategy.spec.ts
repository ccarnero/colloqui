import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type Redis from "ioredis";
import { SlidingWindowStrategy } from "../../src/modules/rate-limit/strategies/sliding-window.strategy";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("SlidingWindowStrategy", () => {
  let strategy: SlidingWindowStrategy;
  const evalshaMock = mock(() => Promise.resolve([1, 5, 30]));

  beforeEach(async () => {
    const redis = {
      script: mock(() => Promise.resolve("sha-slide")),
      evalsha: evalshaMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: SlidingWindowStrategy,
          useFactory: (r: Redis) => new SlidingWindowStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    strategy = moduleRef.get(SlidingWindowStrategy);
  });

  it("maps Lua result to RateLimitResult", async () => {
    const result = await strategy.consume("ratelimit:dev:t1", {
      algorithm: "sliding_window",
      limit: 100,
      windowMs: 60_000,
      capacity: 0,
      refillRate: 0,
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(95);
    expect(result.resetSeconds).toBe(30);
    expect(evalshaMock).toHaveBeenCalled();
  });

  /**
   * Redis Cluster routes multi-key Lua calls by hash slot. The 3 KEYS
   * passed to LUA_SLIDING_WINDOW (prev/curr/ts) MUST share a slot, so
   * we wrap the shared prefix in `{...}`. Regression: the keys passed
   * to evalsha must all contain the same hash-tag substring.
   */
  it("places prev/curr/ts keys in the same Redis Cluster hash slot", async () => {
    await strategy.consume("ratelimit:dev:tenant42", {
      algorithm: "sliding_window",
      limit: 100,
      windowMs: 60_000,
      capacity: 0,
      refillRate: 0,
    });

    const lastCall = evalshaMock.mock.calls.at(-1) as unknown[] | undefined;
    expect(lastCall).toBeDefined();
    const [, numKeys, prevKey, currKey, tsKey] = lastCall as [
      string,
      number,
      string,
      string,
      string,
    ];

    expect(numKeys).toBe(3);
    expect(prevKey).toBe("{ratelimit:dev:tenant42}:prev");
    expect(currKey).toBe("{ratelimit:dev:tenant42}:curr");
    expect(tsKey).toBe("{ratelimit:dev:tenant42}:ts");

    const HASH_TAG = /\{([^}]+)\}/;
    const tag = (s: string): string | undefined => s.match(HASH_TAG)?.[1];
    expect(tag(prevKey)).toBe(tag(currKey));
    expect(tag(currKey)).toBe(tag(tsKey));
  });
});

/**
 * Redis Cluster: SCRIPT LOAD only seeds one node, so EVALSHA can fail
 * with NOSCRIPT on the slot owner. The fallback MUST call EVAL with
 * the script source so the slot owner compiles + caches the script
 * (a re-`SCRIPT LOAD` would just seed another random node).
 */
describe("SlidingWindowStrategy NOSCRIPT fallback", () => {
  it("falls back to EVAL with the script source on NOSCRIPT", async () => {
    const evalshaMock = mock(() =>
      Promise.reject(new Error("NOSCRIPT No matching script. Please use EVAL.")),
    );
    const evalMock = mock(() => Promise.resolve([1, 5, 30]));
    const scriptMock = mock(() => Promise.resolve("sha-slide"));

    const redis = {
      script: scriptMock,
      evalsha: evalshaMock,
      eval: evalMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: SlidingWindowStrategy,
          useFactory: (r: Redis) => new SlidingWindowStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    const strategy = moduleRef.get(SlidingWindowStrategy);

    const result = await strategy.consume("ratelimit:dev:t1", {
      algorithm: "sliding_window",
      limit: 100,
      windowMs: 60_000,
      capacity: 0,
      refillRate: 0,
    });

    expect(result.allowed).toBe(true);
    expect(scriptMock).toHaveBeenCalledTimes(1);
    expect(evalshaMock).toHaveBeenCalledTimes(1);
    expect(evalMock).toHaveBeenCalledTimes(1);

    const evalArgs = evalMock.mock.calls.at(-1) as unknown[] | undefined;
    expect(evalArgs).toBeDefined();
    const [scriptSource, numKeys, prevKey, currKey, tsKey] = evalArgs as [
      string,
      number,
      string,
      string,
      string,
    ];
    expect(typeof scriptSource).toBe("string");
    expect(scriptSource.length).toBeGreaterThan(0);
    expect(numKeys).toBe(3);

    const HASH_TAG = /\{([^}]+)\}/;
    const tag = (s: string): string | undefined => s.match(HASH_TAG)?.[1];
    expect(tag(prevKey)).toBe(tag(currKey));
    expect(tag(currKey)).toBe(tag(tsKey));
  });

  it("re-throws non-NOSCRIPT errors without calling eval", async () => {
    const evalshaMock = mock(() =>
      Promise.reject(new Error("CLUSTERDOWN The cluster is down")),
    );
    const evalMock = mock(() => Promise.resolve([1, 5, 30]));

    const redis = {
      script: mock(() => Promise.resolve("sha-slide")),
      evalsha: evalshaMock,
      eval: evalMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: SlidingWindowStrategy,
          useFactory: (r: Redis) => new SlidingWindowStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    const strategy = moduleRef.get(SlidingWindowStrategy);

    await expect(
      strategy.consume("ratelimit:dev:t1", {
        algorithm: "sliding_window",
        limit: 100,
        windowMs: 60_000,
        capacity: 0,
        refillRate: 0,
      }),
    ).rejects.toThrow("CLUSTERDOWN");
    expect(evalMock).not.toHaveBeenCalled();
  });
});
