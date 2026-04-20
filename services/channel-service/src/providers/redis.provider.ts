import Redis from "ioredis";
import type { FactoryProvider, OnModuleDestroy } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";

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
 *
 * An `error` listener is attached so transient connectivity issues
 * surface as structured log lines instead of Node's noisy
 * `[ioredis] Unhandled error event` output. Messages are throttled
 * via a best-effort de-dup on `message + code` — on a prolonged
 * outage ioredis re-emits on every reconnect attempt and we don't
 * want to flood the log pipeline.
 */
export const redisProvider: FactoryProvider<Redis> = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    const host = process.env.REDIS_HOST ?? "localhost";
    const port = Number(process.env.REDIS_PORT) || 6379;
    const logger = new PinoLoggerService("channel-service-redis");
    const client = new Redis({
      host,
      port,
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
    });

    const seenErrors = new Map<string, number>();
    const LOG_EVERY = 30; // log 1-in-N repeats to avoid flooding
    client.on("error", (err: Error & { code?: string }) => {
      const key = `${err.code ?? "ERR"}:${err.message}`;
      const count = (seenErrors.get(key) ?? 0) + 1;
      seenErrors.set(key, count);
      if (count === 1 || count % LOG_EVERY === 0) {
        logger.warn(
          `redis error (host=${host}:${port}, code=${err.code ?? "n/a"}, repeat=${count}): ${err.message}`,
        );
      }
    });
    client.on("ready", () => {
      logger.log(`redis ready at ${host}:${port}`);
      seenErrors.clear();
    });
    client.on("end", () => {
      logger.warn(`redis connection ended (${host}:${port})`);
    });

    return client;
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
