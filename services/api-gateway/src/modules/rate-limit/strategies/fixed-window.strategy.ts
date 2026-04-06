import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { RateLimitResult, RateLimitTenantConfig } from "@yoizen/shared";
import { REDIS_CLIENT } from "../../../providers/redis.provider";
import type { IRateLimitStrategy } from "./rate-limit.strategy";

/**
 * KEYS[1] = ratelimit:{env}:{tenant}:{windowStart}
 * ARGV[1] = limit
 * ARGV[2] = windowSeconds (TTL for the key)
 *
 * Returns { allowed (0|1), count, ttl }.
 */
const LUA_FIXED_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[2]) end
if count > tonumber(ARGV[1]) then
  return {0, count, ttl}
end
return {1, count, ttl}
`;

@Injectable()
export class FixedWindowStrategy implements IRateLimitStrategy {
  private scriptSha: string | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(
    key: string,
    config: RateLimitTenantConfig,
  ): Promise<RateLimitResult> {
    const windowSec = Math.max(1, Math.ceil(config.windowMs / 1000));
    const windowStart = Math.floor(Date.now() / config.windowMs);
    const redisKey = `${key}:${windowStart}`;

    const result = await this.evalScript(redisKey, config.limit, windowSec);

    const [allowed, count, ttl] = result as [number, number, number];
    const remaining = Math.max(0, config.limit - count);

    return {
      allowed: allowed === 1,
      limit: config.limit,
      remaining,
      resetSeconds: ttl,
    };
  }

  private async evalScript(
    redisKey: string,
    limit: number,
    windowSec: number,
  ): Promise<unknown> {
    if (!this.scriptSha) {
      this.scriptSha = (await this.redis.script(
        "LOAD",
        LUA_FIXED_WINDOW,
      )) as string;
    }
    try {
      return await this.redis.evalsha(
        this.scriptSha,
        1,
        redisKey,
        limit,
        windowSec,
      );
    } catch {
      this.scriptSha = (await this.redis.script(
        "LOAD",
        LUA_FIXED_WINDOW,
      )) as string;
      return this.redis.evalsha(this.scriptSha, 1, redisKey, limit, windowSec);
    }
  }
}
