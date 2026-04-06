import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { RateLimitResult, RateLimitTenantConfig } from "@yoizen/shared";
import { REDIS_CLIENT } from "../../../providers/redis.provider";
import type { IRateLimitStrategy } from "./rate-limit.strategy";

/**
 * Two-window interpolation for a sliding window counter.
 *
 * KEYS[1] = ratelimit:{env}:{tenant}:prev
 * KEYS[2] = ratelimit:{env}:{tenant}:curr
 * KEYS[3] = ratelimit:{env}:{tenant}:ts   (stores the current-window start timestamp in ms)
 *
 * ARGV[1] = limit
 * ARGV[2] = windowMs
 * ARGV[3] = now (ms)
 *
 * Returns { allowed (0|1), estimatedCount, resetMs }.
 */
const LUA_SLIDING_WINDOW = `
local limit     = tonumber(ARGV[1])
local windowMs  = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local windowSec = math.ceil(windowMs / 1000)

local tsRaw = redis.call('GET', KEYS[3])
local winStart = tsRaw and tonumber(tsRaw) or 0

-- If current window has expired, rotate
if now - winStart >= windowMs then
  -- Carry current into prev
  local currCount = redis.call('GET', KEYS[2])
  if now - winStart >= windowMs * 2 then
    -- Both windows expired
    redis.call('SET', KEYS[1], 0, 'EX', windowSec * 2)
  else
    redis.call('SET', KEYS[1], currCount or 0, 'EX', windowSec * 2)
  end
  redis.call('SET', KEYS[2], 0, 'EX', windowSec * 2)
  winStart = now - (now % windowMs)
  redis.call('SET', KEYS[3], winStart, 'EX', windowSec * 2)
end

local prevCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local currCount = tonumber(redis.call('GET', KEYS[2]) or '0')

local elapsed = now - winStart
local weight  = math.max(0, (windowMs - elapsed) / windowMs)
local estimate = prevCount * weight + currCount

if estimate >= limit then
  local resetMs = windowMs - elapsed
  return {0, math.floor(estimate), math.ceil(resetMs / 1000)}
end

redis.call('INCR', KEYS[2])
currCount = currCount + 1
estimate = prevCount * weight + currCount

local resetMs = windowMs - elapsed
return {1, math.floor(estimate), math.ceil(resetMs / 1000)}
`;

@Injectable()
export class SlidingWindowStrategy implements IRateLimitStrategy {
  private scriptSha: string | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(
    key: string,
    config: RateLimitTenantConfig,
  ): Promise<RateLimitResult> {
    const prevKey = `${key}:prev`;
    const currKey = `${key}:curr`;
    const tsKey = `${key}:ts`;
    const now = Date.now();

    const result = await this.evalScript(
      prevKey,
      currKey,
      tsKey,
      config.limit,
      config.windowMs,
      now,
    );

    const [allowed, estimate, resetSec] = result as [number, number, number];
    const remaining = Math.max(0, config.limit - estimate);

    return {
      allowed: allowed === 1,
      limit: config.limit,
      remaining,
      resetSeconds: resetSec,
    };
  }

  private async evalScript(
    prevKey: string,
    currKey: string,
    tsKey: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<unknown> {
    if (!this.scriptSha) {
      this.scriptSha = (await this.redis.script(
        "LOAD",
        LUA_SLIDING_WINDOW,
      )) as string;
    }
    try {
      return await this.redis.evalsha(
        this.scriptSha,
        3,
        prevKey,
        currKey,
        tsKey,
        limit,
        windowMs,
        now,
      );
    } catch {
      this.scriptSha = (await this.redis.script(
        "LOAD",
        LUA_SLIDING_WINDOW,
      )) as string;
      return this.redis.evalsha(
        this.scriptSha,
        3,
        prevKey,
        currKey,
        tsKey,
        limit,
        windowMs,
        now,
      );
    }
  }
}
