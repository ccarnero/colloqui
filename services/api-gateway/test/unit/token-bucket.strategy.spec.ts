import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type Redis from "ioredis";
import { TokenBucketStrategy } from "../../src/modules/rate-limit/strategies/token-bucket.strategy";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("TokenBucketStrategy", () => {
  let strategy: TokenBucketStrategy;
  const evalshaMock = mock(() => Promise.resolve([1, 9, 5]));

  beforeEach(async () => {
    const redis = {
      script: mock(() => Promise.resolve("sha-tb")),
      evalsha: evalshaMock,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: TokenBucketStrategy,
          useFactory: (r: Redis) => new TokenBucketStrategy(r),
          inject: [REDIS_CLIENT],
        },
      ],
    }).compile();
    strategy = moduleRef.get(TokenBucketStrategy);
  });

  it("maps Lua result to RateLimitResult", async () => {
    const result = await strategy.consume("ratelimit:dev:t1", {
      algorithm: "token_bucket",
      limit: 0,
      windowMs: 0,
      capacity: 10,
      refillRate: 1,
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(9);
    expect(result.resetSeconds).toBe(5);
    expect(evalshaMock).toHaveBeenCalled();
  });
});
