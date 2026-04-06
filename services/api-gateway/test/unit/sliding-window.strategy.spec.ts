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
});
