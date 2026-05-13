import Redis from "ioredis";
import {
  DistributedCircuitBreaker,
  type IBreakerConfig,
  type ICircuitBreakerRedis,
} from "@yoizen/shared";
import {
  PinoLoggerService,
  createCircuitBreakerMetrics,
} from "@yoizen/observability";
import { httpAdapterConfig } from "../../config";

/**
 * Process-wide circuit breaker for outbound HTTP execution.
 *
 * - `httpBreaker`: endpoints + service calls. Tight — 5 fails / 60 s
 *   trips OPEN for 30 s. Matches the typical HTTP backend envelope
 *   where a healthy service should not fail 5 times in a rolling
 *   minute.
 *
 * The breaker shares the SAME Redis instance so multiple replicas of this
 * worker converge globally (the entire reason for the distributed
 * breaker in the first place — a per-pod breaker with N replicas
 * takes N × threshold total failures to trip anywhere).
 */

let httpBreakerInstance: DistributedCircuitBreaker | null = null;
let redisInstance: Redis | null = null;

const logger = new PinoLoggerService("circuit-breaker");

function getRedis(): Redis {
  if (redisInstance) return redisInstance;
  redisInstance = new Redis({
    host: httpAdapterConfig.redisHost,
    port: httpAdapterConfig.redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
  return redisInstance;
}

/**
 * Thin adapter between the library's structural Redis contract and
 * ioredis's API. ioredis exposes `SCRIPT LOAD` as
 * `script("LOAD", source)`; the library expects the more ergonomic
 * `scriptLoad(source)`. Wrapping here keeps the shared package
 * agnostic to any specific Redis client.
 */
function adaptIoredis(redis: Redis): ICircuitBreakerRedis {
  return {
    scriptLoad: (source: string) =>
      redis.script("LOAD", source) as Promise<string>,
    evalsha: (sha: string, numKeys: number, ...args: Array<string | number>) =>
      redis.evalsha(sha, numKeys, ...args) as Promise<unknown>,
    eval: (script: string, numKeys: number, ...args: Array<string | number>) =>
      redis.eval(script, numKeys, ...args) as Promise<unknown>,
  };
}

const HTTP_BREAKER_CONFIG: IBreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 30_000,
  successThreshold: 2,
  probeTimeoutMs: 60_000,
  l1CacheMs: 500,
  fallbackOnRedisError: "allow",
  keyPrefix: "cb:connector-runtime:http",
};

export function getHttpBreaker(): DistributedCircuitBreaker {
  if (httpBreakerInstance) return httpBreakerInstance;
  httpBreakerInstance = new DistributedCircuitBreaker(
    adaptIoredis(getRedis()),
    HTTP_BREAKER_CONFIG,
    logger,
    createCircuitBreakerMetrics("connector-runtime"),
  );
  void httpBreakerInstance
    .scriptLoad()
    .catch((err) =>
      logger.warn(
        `http breaker scriptLoad failed (will retry on use): ${String(err)}`,
      ),
    );
  return httpBreakerInstance;
}
