import type { FactoryProvider } from "@nestjs/common";
import type { RedisLike } from "@yoizen/database";
import {
  DistributedCircuitBreaker,
  type IBreakerConfig,
  type ICircuitBreakerRedis,
} from "@yoizen/shared";
import {
  PinoLoggerService,
  createCircuitBreakerMetrics,
} from "@yoizen/observability";
import { REDIS_CLIENT } from "../../providers/redis.provider";

export const EGRESS_BREAKER = "CHANNEL_SERVICE_EGRESS_BREAKER";

/**
 * Structural adapter: ioredis exposes `SCRIPT LOAD` as
 * `script("LOAD", src)`; the shared breaker expects `scriptLoad`.
 *
 * Accepts either `Redis` or `Cluster` — both expose the same
 * `script` / `evalsha` / `eval` surface. The breaker keys are
 * already wrapped in `{...}` hash-tags upstream so the multi-key
 * Lua calls work across cluster shards.
 *
 * Cluster path additionally exposes `scriptLoadAll` so the shared
 * breaker can seed the same script SHA on every master at bootstrap.
 * Without that, ioredis Cluster routes `SCRIPT LOAD` to a single
 * random node and every EVALSHA against another shard returns
 * NOSCRIPT, sending the breaker into its slower EVAL fallback path
 * that itself stampedes across shards under high concurrency.
 */
function adaptIoredis(redis: RedisLike): ICircuitBreakerRedis {
  const cluster = redis as RedisLike & {
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
          // Redis hashes the script source deterministically so every
          // master returns the same SHA. Fire in parallel and pick
          // any one — they MUST agree.
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
 * Egress breaker configuration.
 *
 * Scoped at (tenant, provider) — NOT (tenant, account) — because a
 * provider outage (WhatsApp Cloud API down, Telegram Bot API 5xx
 * storm) affects every account under that tenant uniformly.
 * Opening per-account would require N × threshold failures before
 * any account's traffic gets protected, which defeats the purpose.
 *
 * Thresholds sized for messaging: providers are generally reliable,
 * so 4 fails / 30 s is a strong signal that something is actually
 * wrong (not just one flaky request). Cooldown is 20 s — long
 * enough for provider recovery, short enough to minimize DLQ noise.
 */
const EGRESS_BREAKER_CONFIG: IBreakerConfig = {
  failureThreshold: 4,
  windowMs: 30_000,
  cooldownMs: 20_000,
  successThreshold: 2,
  probeTimeoutMs: 30_000,
  l1CacheMs: 500,
  fallbackOnRedisError: "allow",
  keyPrefix: "cb:channel:egress",
  // Wall-clock budget for any single Redis op inside the breaker.
  // Bumped 300 → 1000 ms during the 2026-05 stress sprint after we
  // discovered the actual bottleneck wasn't Redis latency (~0.13 ms
  // p50) but ioredis command-queue depth: when the breaker rejected
  // at 300 ms, the underlying ioredis command was never cancelled,
  // queue grew unbounded, and every new call inherited the backlog.
  // Now that the Redis provider sets `commandTimeout: 1000` (see
  // `services/channel-service/src/providers/redis.provider.ts`),
  // ioredis itself trims the queue, and this wall-clock budget can
  // match — any timeout is a real "Redis is wedged" signal, not a
  // queue-depth artifact.
  redisTimeoutMs: 1000,
};

export const egressBreakerProvider: FactoryProvider<DistributedCircuitBreaker> =
  {
    provide: EGRESS_BREAKER,
    inject: [REDIS_CLIENT],
    useFactory: (redis: RedisLike): DistributedCircuitBreaker => {
      const logger = new PinoLoggerService("egress-breaker");
      const breaker = new DistributedCircuitBreaker(
        adaptIoredis(redis),
        EGRESS_BREAKER_CONFIG,
        logger,
        createCircuitBreakerMetrics("channel-service"),
      );
      void breaker
        .scriptLoad()
        .catch((err) =>
          logger.warn(
            `egress breaker scriptLoad failed (will retry on use): ${String(err)}`,
          ),
        );
      return breaker;
    },
  };
