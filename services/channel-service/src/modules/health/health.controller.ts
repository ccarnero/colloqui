import { Controller, Get, Inject, Optional } from "@nestjs/common";
import {
  checkMongo,
  checkNats,
  checkPostgres,
  type MongoClient,
  type Sql,
} from "@yoizen/database";
import type { NatsConnection } from "nats";
import { channelServiceConfig } from "../../config";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import { NATS_CONNECTION } from "../../providers/nats.provider";

@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Optional() @Inject(MONGO_CLIENT) private readonly mongo?: MongoClient,
    @Optional() @Inject(POSTGRES_SQL) private readonly sql?: Sql,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: string;
    mongo?: string;
    postgres?: string;
    nats: string;
  }> {
    const natsOk = checkNats(this.nc);

    if (channelServiceConfig.dbEngine === "mongo") {
      const mongoOk = this.mongo ? await checkMongo(this.mongo) : false;
      return {
        status: mongoOk && natsOk ? "ok" : "degraded",
        mongo: mongoOk ? "connected" : "disconnected",
        nats: natsOk ? "connected" : "disconnected",
      };
    }

    const pgOk = this.sql ? await checkPostgres(this.sql) : false;
    return {
      status: pgOk && natsOk ? "ok" : "degraded",
      postgres: pgOk ? "connected" : "disconnected",
      nats: natsOk ? "connected" : "disconnected",
    };
  }
}
