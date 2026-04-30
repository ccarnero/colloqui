import { Controller, Get, Inject } from "@nestjs/common";
import type { Sql } from "@yoizen/database";
import type { NatsConnection } from "nats";
import { checkPostgres, checkNats } from "@yoizen/database";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import { NATS_CONNECTION } from "../../providers/nats.provider";

@Controller()
export class HealthController {
  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: string;
    postgres: string;
    nats: string;
  }> {
    const [pgOk, natsOk] = await Promise.all([
      checkPostgres(this.sql),
      Promise.resolve(checkNats(this.nc)),
    ]);

    return {
      status: pgOk && natsOk ? "ok" : "degraded",
      postgres: pgOk ? "connected" : "disconnected",
      nats: natsOk ? "connected" : "disconnected",
    };
  }
}
