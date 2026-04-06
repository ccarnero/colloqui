import { Controller, Get, Inject } from "@nestjs/common";
import type { Sql } from "postgres";
import { checkPostgres } from "@yoizen/database";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

@Controller()
export class HealthController {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  /**
   * Reports process health based on PostgreSQL connectivity.
   *
   * @returns `ok` when Postgres responds; otherwise `degraded`.
   */
  @Get("health")
  async check(): Promise<{ status: string; postgres: string }> {
    const pgOk = await checkPostgres(this.sql);
    return {
      status: pgOk ? "ok" : "degraded",
      postgres: pgOk ? "connected" : "disconnected",
    };
  }
}
