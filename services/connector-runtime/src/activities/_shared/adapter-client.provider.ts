import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import {
  type AdapterCache,
  createAdapterClientWithRedisAndFetch,
} from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../../config";
import {
  createHttpResponseCache,
  type IHttpResponseCache,
} from "./http-cache/http-response-cache";
import { createRedisClient, type RedisClient } from "./redis-client";

type AdapterClientInstance = ReturnType<
  typeof createAdapterClientWithRedisAndFetch
>;

let adapterClient: AdapterClientInstance | null = null;
let httpResponseCache: IHttpResponseCache | null = null;
let redis: RedisClient | null = null;
let safeCache: AdapterCache | null = null;

/**
 * Lazily-instantiated Redis client honoring `REDIS_CLUSTER_MODE`.
 *
 * Was previously `new Redis(...)` (standalone) regardless of
 * topology — that broke under cluster deployments because non-
 * cluster clients don't follow `MOVED` redirects, so any key
 * whose slot didn't belong to the contacted node failed with
 * `maxRetriesPerRequest` exceeded. The fallout in workflow-http-
 * worker was: SWR cache misses on the adapter mirror tripped the
 * `cb:workflow:http` circuit breaker (recordFailure on every
 * mirror lookup), poisoning the per-(tenant, service) breaker.
 */
function getRedis(): RedisClient {
  if (redis) {
    return redis;
  }

  redis = createRedisClient();
  return redis;
}

const cacheLogger = new PinoLoggerService("workflow-http-redis-cache");
const cacheErrorCounts = new Map<string, number>();
const CACHE_ERROR_LOG_EVERY = 50;

/**
 * Log a Redis cache error with best-effort de-dup so a sustained
 * outage doesn't flood the log pipeline. First occurrence and every
 * Nth repeat are emitted; the rest are silently counted.
 */
function logCacheError(scope: string, err: Error): void {
  const dedupKey = `${scope}:${err.message}`;
  const count = (cacheErrorCounts.get(dedupKey) ?? 0) + 1;
  cacheErrorCounts.set(dedupKey, count);
  if (count === 1 || count % CACHE_ERROR_LOG_EVERY === 0) {
    cacheLogger.warn(
      `redis cache ${scope} error (repeat=${count}): ${err.message}`,
    );
  }
}

/**
 * Best-effort cache adapter for the shared `AdapterClient` and our
 * HTTP-response cache.
 *
 * Both consumers treat their Redis backend as a *cache* — a miss
 * (returning `null`) is a normal, recoverable state that falls back
 * to a fresh upstream fetch. ioredis with `commandTimeout` set will
 * REJECT pending commands when Redis is slow or wedged (queue depth,
 * cluster slot refresh, network blip), and without this wrapper that
 * rejection propagates all the way through `executeServiceCall`,
 * gets recorded as a real upstream failure by the circuit breaker,
 * and trips the breaker even though the actual upstream service is
 * perfectly healthy. We saw exactly this fail mode after wiring
 * `commandTimeout: 1000` into the cluster client during the 2026-05
 * stress sprint.
 *
 * The breaker itself is NOT wrapped — it already has its own
 * `withTimeout` + `fallbackOnRedisError` mechanism and needs to see
 * raw Redis errors to drive the local-fallback path.
 */
/** @internal — exported for unit tests, not part of the public surface. */
export function createSafeAdapterCache(client: RedisClient): AdapterCache {
  return {
    async get(key: string): Promise<string | null> {
      try {
        return await client.get(key);
      } catch (err) {
        logCacheError("get", err as Error);
        return null;
      }
    },
    async setex(
      key: string,
      seconds: number,
      value: string,
    ): Promise<unknown> {
      try {
        return await client.setex(key, seconds, value);
      } catch (err) {
        logCacheError("setex", err as Error);
        return null;
      }
    },
    async del(...keys: string[]): Promise<unknown> {
      try {
        return await client.del(...keys);
      } catch (err) {
        logCacheError("del", err as Error);
        return 0;
      }
    },
  };
}

function getSafeCache(): AdapterCache {
  if (safeCache) return safeCache;
  safeCache = createSafeAdapterCache(getRedis());
  return safeCache;
}

/**
 * Process-wide singleton `AdapterClient`. Centralized here so both
 * `endpoint-call` and `service-call` activities share one Redis pool
 * AND one SWR cache — prevents two clients racing on the same keys.
 */
export function getAdapterClient(): AdapterClientInstance {
  if (adapterClient) return adapterClient;

  adapterClient = createAdapterClientWithRedisAndFetch(
    workflowHttpWorkerConfig.adapterServiceUrl,
    getSafeCache(),
    tracedFetch,
  );

  return adapterClient;
}

export function getHttpResponseCache(): IHttpResponseCache {
  if (httpResponseCache) {
    return httpResponseCache;
  }

  httpResponseCache = createHttpResponseCache(getSafeCache());
  return httpResponseCache;
}
