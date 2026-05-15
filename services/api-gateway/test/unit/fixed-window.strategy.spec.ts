import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type Redis from "ioredis";
import { FixedWindowStrategy } from "../../src/modules/rate-limit/strategies/fixed-window.strategy";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("FixedWindowStrategy", () => {
  let strategy: FixedWindowStrategy;
  const evalshaMock = mock(() => Promise.resolve([1, 1, 59]));

  beforeEach(async () => {
    const redis = {
      script: mock(() => Promise.resolve("sha1abc")),
      evalsha: evalshaMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: FixedWindowStrategy,
          useFactory: (r: Redis) => new FixedWindowStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    strategy = moduleRef.get(FixedWindowStrategy);
  });

  it("consumes budget via Redis Lua and maps to RateLimitResult", async () => {
    const result = await strategy.consume("ratelimit:dev:tenant1", {
      limit: 100,
      windowMs: 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(99);
    expect(result.resetSeconds).toBe(59);
    expect(evalshaMock).toHaveBeenCalled();
  });
});

/**
 * Redis Cluster: SCRIPT LOAD only seeds one node, so EVALSHA can fail
 * with NOSCRIPT on the slot owner. The fallback MUST call EVAL with
 * the script source so the slot owner compiles + caches the script
 * (a re-`SCRIPT LOAD` would just seed another random node).
 */
describe("FixedWindowStrategy NOSCRIPT fallback", () => {
  it("falls back to EVAL with the script source on NOSCRIPT", async () => {
    const evalshaMock = mock(() =>
      Promise.reject(new Error("NOSCRIPT No matching script. Please use EVAL.")),
    );
    const evalMock = mock(() => Promise.resolve([1, 1, 59]));
    const scriptMock = mock(() => Promise.resolve("sha-fw"));

    const redis = {
      script: scriptMock,
      evalsha: evalshaMock,
      eval: evalMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: FixedWindowStrategy,
          useFactory: (r: Redis) => new FixedWindowStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    const strategy = moduleRef.get(FixedWindowStrategy);

    const result = await strategy.consume("ratelimit:dev:tenant1", {
      limit: 100,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(true);
    expect(scriptMock).toHaveBeenCalledTimes(1);
    expect(evalshaMock).toHaveBeenCalledTimes(1);
    expect(evalMock).toHaveBeenCalledTimes(1);

    const evalArgs = evalMock.mock.calls.at(-1) as unknown[] | undefined;
    expect(evalArgs).toBeDefined();
    const [scriptSource, numKeys, redisKey] = evalArgs as [
      string,
      number,
      string,
    ];
    expect(typeof scriptSource).toBe("string");
    expect(scriptSource.length).toBeGreaterThan(0);
    expect(numKeys).toBe(1);
    expect(redisKey.startsWith("ratelimit:dev:tenant1")).toBe(true);
  });

  it("re-throws non-NOSCRIPT errors without calling eval", async () => {
    const evalshaMock = mock(() =>
      Promise.reject(new Error("READONLY You can't write against a replica.")),
    );
    const evalMock = mock(() => Promise.resolve([1, 1, 59]));

    const redis = {
      script: mock(() => Promise.resolve("sha-fw")),
      evalsha: evalshaMock,
      eval: evalMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: FixedWindowStrategy,
          useFactory: (r: Redis) => new FixedWindowStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    const strategy = moduleRef.get(FixedWindowStrategy);

    await expect(
      strategy.consume("ratelimit:dev:tenant1", {
        limit: 100,
        windowMs: 60_000,
      }),
    ).rejects.toThrow("READONLY");
    expect(evalMock).not.toHaveBeenCalled();
  });
});
