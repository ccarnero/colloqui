import Redis from "ioredis";
import type { Cluster } from "ioredis";
import { workflowHttpWorkerConfig } from "../../config";

/**
 * Either a standalone ioredis `Redis` or a sharded `Cluster`. Both
 * expose the same `get`/`set`/`evalsha`/... surface for our usage,
 * so the rest of the worker treats them uniformly.
 *
 * NOTE: kept here on purpose instead of importing from
 * `@yoizen/database`. workflow-http-worker is a small Temporal
 * worker and pulling that package would drag NestJS, kubernetes-
 * client, and postgres peer-deps into this binary. Any change to
 * the cluster contract MUST be mirrored in
 * `@yoizen/database/src/redis-provider.ts`.
 */
export type RedisClient = Redis | Cluster;

interface IRedisClientOptions {
  /** Override for tests: allows injecting `REDIS_CLUSTER_MODE` flag. */
  readonly clusterMode?: boolean;
  /** Override for tests: allows injecting host. */
  readonly host?: string;
  /** Override for tests: allows injecting port. */
  readonly port?: number;
}

/**
 * Returns a Redis client matching the topology configured via
 * `REDIS_CLUSTER_MODE`. When true, the client is slot-aware and
 * follows `MOVED` redirects automatically — required when Redis is
 * deployed as a cluster. When false / unset, a single-node client
 * is returned (legacy standalone topology).
 *
 * Critical: instantiating a non-cluster client against a cluster
 * node breaks every key that hashes to a slot the contacted node
 * does not own (server replies `MOVED slot host:port`, ioredis
 * surfaces it as an error, and after `maxRetriesPerRequest` the
 * command fails permanently). This factory exists so every Redis
 * consumer in this worker stays consistent with the deployed
 * topology.
 */
export function createRedisClient(
  options: IRedisClientOptions = {},
): RedisClient {
  const clusterMode =
    options.clusterMode ?? workflowHttpWorkerConfig.redisClusterMode;
  const host = options.host ?? workflowHttpWorkerConfig.redisHost;
  const port = options.port ?? workflowHttpWorkerConfig.redisPort;

  if (clusterMode) {
    return new Redis.Cluster([{ host, port }], {
      enableReadyCheck: true,
      lazyConnect: true,
      scaleReads: "slave",
      redisOptions: {
        maxRetriesPerRequest: 2,
        // Per-command wall-clock budget at the ioredis layer. Without
        // this, commands sit in the per-node command queue forever
        // waiting for a response — when the breaker's `withTimeout`
        // rejects at the application layer, the underlying command is
        // NEVER cancelled and queue depth grows unbounded under
        // sustained activity bursts. 1000 ms gives Redis ample room
        // for any realistic single-RTT operation (steady-state p50 is
        // ~0.13 ms) and lets ioredis reject + queue-trim properly when
        // the network is actually wedged.
        commandTimeout: 1000,
      },
      slotsRefreshInterval: 5000,
      slotsRefreshTimeout: 2000,
    });
  }

  return new Redis({
    host,
    port,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    commandTimeout: 1000,
  });
}
