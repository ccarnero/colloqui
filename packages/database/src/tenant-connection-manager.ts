import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import postgres from "postgres";
import type { Sql } from "./types";
import { requireEnv } from "./require-env";

const PG_DATABASE = "yoizen";

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly initialized = new Set<string>();
  private schemaSql: string[] = [];

  private readonly port = Number(process.env.POSTGRES_PORT) || 5432;
  private readonly username = process.env.POSTGRES_USER ?? "yoizen";
  private readonly password = requireEnv("POSTGRES_PASSWORD");
  private readonly env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

  /**
   * Registers DDL statements to run once per tenant on first `ensureSchema` call.
   */
  setSchema(statements: string[]): void {
    this.schemaSql = statements;
  }

  getKnownTenantIds(): string[] {
    return Array.from(this.pools.keys());
  }

  /**
   * Returns the connection for `tenantId`, lazily running registered
   * schema DDL if this tenant has not been initialized yet.
   */
  async ensureSchema(tenantId: string): Promise<Sql> {
    const sql = this.getConnection(tenantId);
    if (!this.initialized.has(tenantId) && this.schemaSql.length > 0) {
      for (const statement of this.schemaSql) {
        await sql.unsafe(statement);
      }
      this.initialized.add(tenantId);
      this.logger.log(`Schema initialized for tenant '${tenantId}'`);
    }
    return sql;
  }

  getConnection(tenantId: string): Sql {
    const existing = this.pools.get(tenantId);
    if (existing) return existing;

    const host = `postgres.${tenantId}-${this.env}-ns.svc.cluster.local`;
    const pool = postgres({
      host,
      port: this.port,
      database: PG_DATABASE,
      username: this.username,
      password: this.password,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 30,
    });
    this.pools.set(tenantId, pool);
    this.logger.log(
      `Created connection pool for tenant '${tenantId}' -> ${host}/${PG_DATABASE}`,
    );
    return pool;
  }

  isInitialized(tenantId: string): boolean {
    return this.initialized.has(tenantId);
  }

  markInitialized(tenantId: string): void {
    this.initialized.add(tenantId);
  }

  /**
   * Returns true when there are no pools yet, or at least one tenant pool answers `SELECT 1`.
   */
  async verifyConnectivity(): Promise<boolean> {
    if (this.pools.size === 0) {
      return true;
    }
    for (const sql of this.pools.values()) {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      tasks.push(pool.end());
    }
    await Promise.all(tasks);
    this.pools.clear();
    this.initialized.clear();
  }
}
