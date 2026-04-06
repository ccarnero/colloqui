import type { NatsConnection } from "nats";
import type Redis from "ioredis";
import { checkNats, checkRedis } from "./health-checks";

export interface INatsRedisHealthInput {
  nc: NatsConnection;
  redis: Redis;
}

/**
 * Shared health aggregation for services that use NATS + Redis
 * (event-processor, webhook-service, etc.).
 */
export async function getNatsRedisHealthStatus(
  input: INatsRedisHealthInput,
): Promise<{
  status: "ok" | "degraded";
  nats: boolean;
  redis: boolean;
}> {
  const [natsOk, redisOk] = await Promise.all([
    Promise.resolve(checkNats(input.nc)),
    checkRedis(input.redis),
  ]);
  return {
    status: natsOk && redisOk ? "ok" : "degraded",
    nats: natsOk,
    redis: redisOk,
  };
}
