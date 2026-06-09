import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import type Redis from "ioredis";
import {
  NATS_CONNECTION,
  REDIS_CLIENT,
  checkNats,
  checkRedis,
} from "@yoizen/database";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async getHealth(): Promise<{
    status: "ok" | "degraded";
    nats: "connected" | "disconnected";
    redis: "connected" | "disconnected";
  }> {
    const [natsOk, redisOk] = await Promise.all([
      Promise.resolve(checkNats(this.nc)),
      checkRedis(this.redis),
    ]);
    return {
      status: natsOk && redisOk ? "ok" : "degraded",
      nats: natsOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
    };
  }
}
