import { Controller, Get, Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { checkRedis, REDIS_CLIENT } from "@yoizen/database";
import type { ICacheServiceHealthResponse } from "@yoizen/shared";

@Controller()
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get("health")
  async check(): Promise<ICacheServiceHealthResponse> {
    const redisOk = await checkRedis(this.redis);
    return {
      status: redisOk ? "ok" : "degraded",
      redis: redisOk ? "connected" : "disconnected",
    };
  }
}
