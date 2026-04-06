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
