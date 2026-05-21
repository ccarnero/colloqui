import type { FactoryProvider, OnModuleDestroy } from "@nestjs/common";
import { createRedisClient, type RedisLike } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";

export const REDIS_CLIENT = "CHANNEL_SERVICE_REDIS_CLIENT";

/**
 * Minimal Redis provider for channel-service. Currently used by the
 * egress distributed circuit breaker (per-tenant, per-provider
 * isolation). Builds the raw client through `createRedisClient` from
 * `@yoizen/database` so we honour `REDIS_CLUSTER_MODE` and stay in
 * lockstep with every other service when the cluster topology
 * changes; the rest of `@yoizen/database`'s Nest modules (Postgres,
 * tenant managers) are NOT imported here.
 *
 * Reads `REDIS_HOST` / `REDIS_PORT` / `REDIS_CLUSTER_MODE` from env.
 * `lazyConnect: true` keeps the process startable even if Redis is
 * temporarily down (the breaker itself falls back to a local
 * in-memory view in that case).
 *
 * An `error` listener is attached so transient connectivity issues
 * surface as structured log lines instead of Node's noisy
 * `[ioredis] Unhandled error event` output. Messages are throttled
 * via a best-effort de-dup on `message + code` — on a prolonged
 * outage ioredis re-emits on every reconnect attempt and we don't
 * want to flood the log pipeline.
 */
export const redisProvider: FactoryProvider<RedisLike> = {
  provide: REDIS_CLIENT,
  useFactory: (): RedisLike => {
    const host = process.env.REDIS_HOST ?? "localhost";
    const port = Number(process.env.REDIS_PORT) || 6379;
    const logger = new PinoLoggerService("channel-service-redis");
    // `commandTimeout: 1000` makes ioredis actively cancel queued
    // commands when the response hasn't arrived in 1 s. Without it the
    // egress breaker's wall-clock timeout rejects the application-side
    // promise but leaves the underlying ioredis command sitting in the
    // per-node queue forever, so under sustained bursts the queue
    // depth itself becomes the bottleneck (every new call inherits
    // the backlog). 1 s is generous against the ~0.13 ms Redis p50
    // we measured in cluster mode and matches the breaker budget set
    // in `egress-breaker.provider.ts`.
    const client = createRedisClient({
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
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
  constructor(private readonly redis: RedisLike) {}
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      /* best-effort */
    }
  }
}
