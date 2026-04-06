import { Controller, Get, Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { checkPostgres, checkRedis } from "@yoizen/database";
import type { IAuthServiceHealthResponse } from "@yoizen/shared";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";
import { REDIS_CLIENT } from "@yoizen/database";

@Controller()
export class HealthController {
  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get("health")
  async check(): Promise<IAuthServiceHealthResponse> {
    const [pgOk, redisOk] = await Promise.all([
      checkPostgres(this.sql),
      checkRedis(this.redis),
    ]);

    const status = pgOk && redisOk ? "ok" : "degraded";

    return {
      status,
      postgres: pgOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
    };
  }
}
