import { Controller, Get, Inject, Optional } from "@nestjs/common";
import type Redis from "ioredis";
import {
  checkMongo,
  checkPostgres,
  checkRedis,
  REDIS_CLIENT,
  type MongoClient,
  type Sql,
} from "@yoizen/database";
import type { IAuthServiceHealthResponse } from "@yoizen/shared";
import { authServiceConfig } from "../../config";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { POSTGRES_SQL } from "../../providers/postgres.module";

@Controller()
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() @Inject(MONGO_CLIENT) private readonly mongo?: MongoClient,
    @Optional() @Inject(POSTGRES_SQL) private readonly sql?: Sql,
  ) {}

  @Get("health")
  async check(): Promise<IAuthServiceHealthResponse> {
    const redisOk = await checkRedis(this.redis);

    if (authServiceConfig.dbEngine === "mongo") {
      const mongoOk = this.mongo ? await checkMongo(this.mongo) : false;
      const status = mongoOk && redisOk ? "ok" : "degraded";
      return {
        status,
        mongo: mongoOk ? "connected" : "disconnected",
        redis: redisOk ? "connected" : "disconnected",
      };
    }

    const pgOk = this.sql ? await checkPostgres(this.sql) : false;
    const status = pgOk && redisOk ? "ok" : "degraded";
    return {
      status,
      postgres: pgOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
    };
  }
}
