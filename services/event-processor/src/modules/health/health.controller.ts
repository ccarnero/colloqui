import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import type Redis from "ioredis";
import { checkNats, checkRedis } from "@yoizen/database";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { REDIS_CLIENT } from "../../providers/redis.provider";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nats: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<{
    status: string;
    nats: boolean;
    redis: boolean;
  }> {
    const [natsOk, redisOk] = await Promise.all([
      Promise.resolve(checkNats(this.nats)),
      checkRedis(this.redis),
    ]);
    return {
      status: natsOk && redisOk ? "ok" : "degraded",
      nats: natsOk,
      redis: redisOk,
    };
  }
}
