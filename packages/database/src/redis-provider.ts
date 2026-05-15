import Redis from "ioredis";
import type { Cluster } from "ioredis";
import type { FactoryProvider } from "@nestjs/common";

export const REDIS_CLIENT = "REDIS_CLIENT";

/**
 * Unified type for any Redis client this module hands out. At runtime
 * a single ioredis instance is either a standalone `Redis` (single
 * primary) or a sharded `Cluster` (3+ masters). Both share the same
 * core API surface (`get`/`set`/`del`/`eval`/`evalsha`/`script`/
 * `pipeline`/`multi`); cluster mode adds the constraint that
 * multi-key operations must hash to the same slot — see callers that
 * use `{...}` hash-tags in their keys.
 */
export type RedisLike = Redis | Cluster;

export interface RedisClientOptions {
  /** Default host when REDIS_HOST is not set (default: "localhost") */
  defaultHost?: string;
  /** Default port when REDIS_PORT is not set (default: 6379) */
  defaultPort?: number;
  /** Max retries per request (default: 3) */
  maxRetriesPerRequest?: number;
  /**
   * Per-command wall-clock budget in ms. When unset, ioredis holds a
   * command in its per-node queue indefinitely waiting for a response,
   * which makes high-concurrency call-sites accumulate zombie commands
   * whenever an upstream timer (application-level breaker, Promise.race,
   * etc.) rejects first. Setting this lets ioredis actively cancel the
   * command and trim its queue — the only safe option for sustained
   * burst workloads. Recommended: ~10x your steady-state p99 (Redis
   * single-RTT in-cluster is ~0.5 ms so 1000 is generous).
   */
  commandTimeout?: number;
}

/**
 * Backwards-compatible alias. Older code imports
 * `RedisProviderOptions` — keep the name available but extend the
 * shared options shape.
 */
export type RedisProviderOptions = RedisClientOptions;

/**
 * Build a low-level ioredis client.
 *
 * - When `REDIS_CLUSTER_MODE === "true"` returns a `Cluster` whose
 *   seed node is `REDIS_HOST:REDIS_PORT`. The client discovers every
 *   shard via `CLUSTER SLOTS` and routes keys by hash slot. Reads can
 *   be served by replicas (`scaleReads: "slave"`).
 * - Otherwise returns a standalone `Redis` connecting to
 *   `REDIS_HOST:REDIS_PORT`.
 *
 * `lazyConnect` is enabled in both modes so the consumer controls
 * when the first TCP handshake happens (Nest bootstraps then opens
 * connections in module init hooks instead of on import).
 */
export function createRedisClient(
  options: RedisClientOptions = {},
): RedisLike {
  const {
    defaultHost = "localhost",
    defaultPort = 6379,
    maxRetriesPerRequest = 3,
    commandTimeout,
  } = options;

  const host = process.env.REDIS_HOST ?? defaultHost;
  const port = Number(process.env.REDIS_PORT) || defaultPort;
  const clusterMode = process.env.REDIS_CLUSTER_MODE === "true";

  if (!clusterMode) {
    return new Redis({
      host,
      port,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest,
      ...(commandTimeout !== undefined && { commandTimeout }),
    });
  }

  return new Redis.Cluster([{ host, port }], {
    enableReadyCheck: true,
    lazyConnect: true,
    // Spread reads to replicas; writes always go to the master of the
    // target slot. Single-key writes stay 1 RTT, multi-key Lua / pipe
    // ops require co-located keys (use {hashtag} in callers).
    scaleReads: "slave",
    redisOptions: {
      maxRetriesPerRequest,
      ...(commandTimeout !== undefined && { commandTimeout }),
    },
    // Refresh slot map periodically so failovers (replica promotion)
    // are picked up without a redeploy. Cheap (~1 small command).
    slotsRefreshInterval: 5000,
    slotsRefreshTimeout: 2000,
  });
}

/**
 * Creates a NestJS `FactoryProvider` for the Redis client. Reads
 * `REDIS_HOST`, `REDIS_PORT`, and `REDIS_CLUSTER_MODE` from the
 * environment.
 */
export function createRedisProvider(
  options: RedisProviderOptions = {},
): FactoryProvider<RedisLike> {
  return {
    provide: REDIS_CLIENT,
    useFactory: (): RedisLike => createRedisClient(options),
  };
}

/**
 * Shared default provider used by services that don't need custom
 * options.
 */
export const redisProvider: FactoryProvider<RedisLike> =
  createRedisProvider();
