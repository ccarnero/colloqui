import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { RateLimitResult, RateLimitTenantConfig } from "@yoizen/shared";
import { REDIS_CLIENT } from "../../../providers/redis.provider";
import type { IRateLimitStrategy } from "./rate-limit.strategy";

/**
 * Token bucket implemented as a Redis hash.
 *
 * KEYS[1] = ratelimit:{env}:{tenant}:tb
 *
 * ARGV[1] = capacity
 * ARGV[2] = refillRate (tokens per second)
 * ARGV[3] = now (ms)
 *
 * Hash fields: tokens, lastRefill (ms timestamp).
 * Returns { allowed (0|1), remainingTokens, secondsUntilFull }.
 */
const LUA_TOKEN_BUCKET = `
local capacity   = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])

local data = redis.call('HMGET', KEYS[1], 'tokens', 'lastRefill')
local tokens     = tonumber(data[1])
local lastRefill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  lastRefill = now
end

-- Add tokens accrued since last refill
local elapsedSec = (now - lastRefill) / 1000
if elapsedSec > 0 then
  tokens = math.min(capacity, tokens + elapsedSec * refillRate)
  lastRefill = now
end

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'lastRefill', lastRefill)
-- Expire the hash after enough time to fully refill twice (avoids leaking keys)
local ttl = math.ceil((capacity / refillRate) * 2)
if ttl < 60 then ttl = 60 end
redis.call('EXPIRE', KEYS[1], ttl)

local secUntilFull = 0
if tokens < capacity then
  secUntilFull = math.ceil((capacity - tokens) / refillRate)
end

return {allowed, math.floor(tokens), secUntilFull}
`;

@Injectable()
export class TokenBucketStrategy implements IRateLimitStrategy {
  private scriptSha: string | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(
    key: string,
    config: RateLimitTenantConfig,
  ): Promise<RateLimitResult> {
    const redisKey = `${key}:tb`;
    const now = Date.now();

    const result = await this.evalScript(
      redisKey,
      config.capacity,
      config.refillRate,
      now,
    );

    const [allowed, remaining, secUntilFull] = result as [
      number,
      number,
      number,
    ];

    return {
      allowed: allowed === 1,
      limit: config.capacity,
      remaining,
      resetSeconds: secUntilFull,
    };
  }

  private async evalScript(
    redisKey: string,
    capacity: number,
    refillRate: number,
    now: number,
  ): Promise<unknown> {
    if (!this.scriptSha) {
      this.scriptSha = (await this.redis.script(
        "LOAD",
        LUA_TOKEN_BUCKET,
      )) as string;
    }
    try {
      return await this.redis.evalsha(
        this.scriptSha,
        1,
        redisKey,
        capacity,
        refillRate,
        now,
      );
    } catch {
      this.scriptSha = (await this.redis.script(
        "LOAD",
        LUA_TOKEN_BUCKET,
      )) as string;
      return this.redis.evalsha(
        this.scriptSha,
        1,
        redisKey,
        capacity,
        refillRate,
        now,
      );
    }
  }
}
