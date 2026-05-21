import {
  DistributedCircuitBreaker,
  type IBreakerConfig,
  type ICircuitBreakerRedis,
} from "@yoizen/shared";
import {
  PinoLoggerService,
  createCircuitBreakerMetrics,
} from "@yoizen/observability";
import { createRedisClient, type RedisClient } from "./redis-client";

/**
 * Process-wide circuit breakers for outbound activity calls. Two
 * distinct instances because agent calls (LLMs) have very different
 * latency/failure envelopes than plain HTTP endpoints:
 *
 * - `httpBreaker`: endpoints + service calls. Tight — 5 fails / 60 s
 *   trips OPEN for 30 s. Matches the typical HTTP backend envelope
 *   where a healthy service should not fail 5 times in a rolling
 *   minute.
 *
 * - `agentBreaker`: LLM/agent calls. Looser — 10 fails / 120 s trips
 *   OPEN for 60 s with a 5-minute probe timeout. LLMs have wider
 *   latency distributions and occasional upstream flakiness is
 *   expected; we don't want to open the breaker on a single cold
 *   start.
 *
 * Both share the SAME Redis instance so multiple replicas of this
 * worker converge globally (the entire reason for the distributed
 * breaker in the first place — a per-pod breaker with N replicas
 * takes N × threshold total failures to trip anywhere).
 */

let httpBreakerInstance: DistributedCircuitBreaker | null = null;
let agentBreakerInstance: DistributedCircuitBreaker | null = null;
let redisInstance: RedisClient | null = null;

const logger = new PinoLoggerService("circuit-breaker");

function getRedis(): RedisClient {
  if (redisInstance) return redisInstance;
  redisInstance = createRedisClient();
  return redisInstance;
}

/**
 * Thin adapter between the library's structural Redis contract and
 * ioredis's API. ioredis exposes `SCRIPT LOAD` as
 * `script("LOAD", source)`; the library expects the more ergonomic
 * `scriptLoad(source)`. Wrapping here keeps the shared package
 * agnostic to any specific Redis client.
 *
 * Works for both standalone `Redis` and sharded `Cluster` — both
 * expose the same `script` / `evalsha` / `eval` surface. The
 * breaker's keys already use `{...}` hash-tags so multi-key Lua
 * calls land on the same cluster shard.
 *
 * Cluster path additionally exposes `scriptLoadAll` so the breaker's
 * one-time bootstrap seeds every master with the script SHA. Without
 * this, ioredis Cluster routes `SCRIPT LOAD` to a single random node;
 * EVALSHA against any other shard returns NOSCRIPT and triggers the
 * breaker's slower `EVAL` fallback. Under load with a single hot
 * tenant key (all hashes collide on one master) the recovery itself
 * stampedes because each NOSCRIPT reloads on a random node again.
 */
function adaptIoredis(redis: RedisClient): ICircuitBreakerRedis {
  const cluster = redis as RedisClient & {
    nodes?: (
      role: "master" | "slave" | "all",
    ) => Array<{
      script(op: "LOAD", source: string): Promise<string>;
    }>;
  };
  const isCluster = typeof cluster.nodes === "function";

  return {
    scriptLoad: (source: string) =>
      redis.script("LOAD", source) as Promise<string>,
    scriptLoadAll: isCluster
      ? async (source: string): Promise<string> => {
          const masters = cluster.nodes?.("master") ?? [];
          if (masters.length === 0) {
            return redis.script("LOAD", source) as Promise<string>;
          }
          // Redis computes the SHA deterministically from the source,
          // so every master returns the same string. Fire in parallel
          // and pick the first — they MUST agree.
          const shas = await Promise.all(
            masters.map((node) =>
              node.script("LOAD", source) as Promise<string>,
            ),
          );
          return shas[0];
        }
      : undefined,
    evalsha: (sha: string, numKeys: number, ...args: Array<string | number>) =>
      redis.evalsha(sha, numKeys, ...args) as Promise<unknown>,
    eval: (script: string, numKeys: number, ...args: Array<string | number>) =>
      redis.eval(script, numKeys, ...args) as Promise<unknown>,
  };
}

/**
 * Exported cooldown constants. Activities use these as the
 * `nextRetryDelay` hint on retryable `CIRCUIT_OPEN` failures so
 * Temporal reschedules the next attempt RIGHT after the breaker
 * leaves the OPEN state, instead of burning the workflow's retry
 * budget on the default exponential backoff (which is faster than
 * the cooldown and would just hit DENY again).
 */
export const HTTP_BREAKER_COOLDOWN_MS = 30_000;
export const AGENT_BREAKER_COOLDOWN_MS = 60_000;

// Wall-clock budget for any single Redis op inside the breaker.
//
// We bumped this twice during the 2026-05 stress sprint:
//   - 100 ms (shared lib default) → 300 ms: tolerate cluster-bus and
//     MOVED-redirect tail latency.
//   - 300 ms → 1000 ms: the previous bump was masking the real bug.
//     Under stress, Redis itself stays at ~0.13 ms p50 (verified via
//     `INFO commandstats`), but the ioredis Cluster client had no
//     `commandTimeout` so per-shard command queues grew unbounded
//     when the breaker rejected. Each rejection left a "zombie"
//     command waiting on the queue, so the next activity's RTT
//     was paying the cost of queue depth, not Redis latency.
//
// Now that ioredis itself enforces `commandTimeout: 1000` (see
// `redis-client.ts`) the breaker's wall-clock budget should match —
// any timeout is a real "Redis is broken" signal, not a queue-depth
// artifact. 1 s is still ~3% of the default 30 s activity SLA.
const BREAKER_REDIS_TIMEOUT_MS = 1000;

const HTTP_BREAKER_CONFIG: IBreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: HTTP_BREAKER_COOLDOWN_MS,
  successThreshold: 2,
  probeTimeoutMs: 60_000,
  l1CacheMs: 500,
  fallbackOnRedisError: "allow",
  keyPrefix: "cb:workflow:http",
  redisTimeoutMs: BREAKER_REDIS_TIMEOUT_MS,
};

const AGENT_BREAKER_CONFIG: IBreakerConfig = {
  failureThreshold: 10,
  windowMs: 120_000,
  cooldownMs: AGENT_BREAKER_COOLDOWN_MS,
  successThreshold: 3,
  probeTimeoutMs: 300_000,
  l1CacheMs: 500,
  fallbackOnRedisError: "allow",
  keyPrefix: "cb:workflow:agent",
  redisTimeoutMs: BREAKER_REDIS_TIMEOUT_MS,
};

export function getHttpBreaker(): DistributedCircuitBreaker {
  if (httpBreakerInstance) return httpBreakerInstance;
  httpBreakerInstance = new DistributedCircuitBreaker(
    adaptIoredis(getRedis()),
    HTTP_BREAKER_CONFIG,
    logger,
    createCircuitBreakerMetrics("workflow-http-worker"),
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

export function getAgentBreaker(): DistributedCircuitBreaker {
  if (agentBreakerInstance) return agentBreakerInstance;
  agentBreakerInstance = new DistributedCircuitBreaker(
    adaptIoredis(getRedis()),
    AGENT_BREAKER_CONFIG,
    logger,
    createCircuitBreakerMetrics("workflow-http-worker"),
  );
  void agentBreakerInstance
    .scriptLoad()
    .catch((err) =>
      logger.warn(
        `agent breaker scriptLoad failed (will retry on use): ${String(err)}`,
      ),
    );
  return agentBreakerInstance;
}
