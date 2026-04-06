import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import type Redis from "ioredis";
import { NATS_CONNECTION } from "./nats-provider";
import { REDIS_CLIENT } from "./redis-provider";
import { getNatsRedisHealthStatus } from "./nats-redis-health";

/**
 * Shared GET /health for services that use NATS + Redis.
 */
@Controller()
export class NatsRedisHealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    redis: boolean;
  }> {
    return getNatsRedisHealthStatus({ nc: this.nc, redis: this.redis });
  }
}
