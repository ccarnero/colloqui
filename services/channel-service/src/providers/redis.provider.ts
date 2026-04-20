import Redis from "ioredis";
import type { FactoryProvider, OnModuleDestroy } from "@nestjs/common";

export const REDIS_CLIENT = "CHANNEL_SERVICE_REDIS_CLIENT";

/**
 * Minimal Redis provider for channel-service. Currently used by the
 * egress distributed circuit breaker (per-tenant, per-provider
 * isolation). Kept as a small `FactoryProvider` on purpose — we do
 * NOT want to pull in `@yoizen/database`'s Nest modules here because
 * channel-service doesn't speak to the rest of the DB layer via
 * Postgres through that package.
 *
 * Reads `REDIS_HOST` and `REDIS_PORT` from env with sane localhost
 * defaults. `lazyConnect: true` keeps the process startable even if
 * Redis is temporarily down (the breaker itself falls back to a
 * local in-memory view in that case).
 */
export const redisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    const host = process.env.REDIS_HOST ?? "localhost";
    const port = Number(process.env.REDIS_PORT) || 6379;
    return new Redis({
      host,
      port,
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
    });
  },
};

/**
 * Lifecycle disposer for the Redis client, so `OnModuleDestroy`
 * holders can close it cleanly during a Nest shutdown. Safe to
 * call more than once; ioredis ignores double-quit.
 */
export class RedisClientDisposer implements OnModuleDestroy {
  constructor(private readonly redis: Redis) {}
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      /* best-effort */
    }
  }
}
