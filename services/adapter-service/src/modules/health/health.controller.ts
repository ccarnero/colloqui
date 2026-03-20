import { Controller, Get, Inject } from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

@Controller()
export class HealthController {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  @Get("health")
  async check(): Promise<{ status: string; postgres: string }> {
    const pgOk = await this.checkPostgres();
    return {
      status: pgOk ? "ok" : "degraded",
      postgres: pgOk ? "connected" : "disconnected",
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
}
