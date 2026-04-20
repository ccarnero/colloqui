import type { FactoryProvider } from "@nestjs/common";
import type Redis from "ioredis";
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
};

export const egressBreakerProvider: FactoryProvider<DistributedCircuitBreaker> =
  {
    provide: EGRESS_BREAKER,
    inject: [REDIS_CLIENT],
    useFactory: (redis: Redis): DistributedCircuitBreaker => {
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
