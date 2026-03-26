import { Controller, Get, Inject } from "@nestjs/common";
import type { Sql } from "postgres";
import type { NatsConnection } from "nats";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import { NATS_CONNECTION } from "../../providers/nats.provider";

interface HealthStatus {
  status: string;
  postgres: string;
  nats: string;
}

@Controller()
export class HealthController {
  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  @Get("health")
  async check(): Promise<HealthStatus> {
    const [pgOk, natsOk] = await Promise.all([
      this.checkPostgres(),
      this.checkNats(),
    ]);

    const status = pgOk && natsOk ? "ok" : "degraded";
    return {
      status,
      postgres: pgOk ? "connected" : "disconnected",
      nats: natsOk ? "connected" : "disconnected",
    };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private checkNats(): Promise<boolean> {
    return Promise.resolve(!this.nc.isClosed());
  }
}
