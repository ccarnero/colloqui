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
  private schemaInitializer: ((tenantId: string, sql: Sql) => Promise<void>) | null =
    null;
  private readonly pendingSchemaInit = new Map<string, Promise<void>>();

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

  /**
   * Registers async schema setup (e.g. multi-statement transactions) after
   * {@link setSchema} static DDL. Runs once per tenant with deduplication.
   */
  setSchemaInitializer(
    fn: (tenantId: string, sql: Sql) => Promise<void>,
  ): void {
    this.schemaInitializer = fn;
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
    if (this.initialized.has(tenantId)) {
      return sql;
    }

    const pending = this.pendingSchemaInit.get(tenantId);
    if (pending) {
      await pending;
      return sql;
    }

    const work = this.runTenantSchemaInit(tenantId, sql);
    this.pendingSchemaInit.set(tenantId, work);
    try {
      await work;
    } finally {
      this.pendingSchemaInit.delete(tenantId);
    }
    return sql;
  }

  private async runTenantSchemaInit(
    tenantId: string,
    sql: Sql,
  ): Promise<void> {
    if (this.initialized.has(tenantId)) {
      return;
    }
    const hasStatic = this.schemaSql.length > 0;
    const hasAsyncInit = this.schemaInitializer !== null;
    if (!hasStatic && !hasAsyncInit) {
      return;
    }
    if (hasStatic) {
      for (const statement of this.schemaSql) {
        await sql.unsafe(statement);
      }
    }
    if (this.schemaInitializer) {
      await this.schemaInitializer(tenantId, sql);
    }
    this.initialized.add(tenantId);
    this.logger.log(`Schema initialized for tenant '${tenantId}'`);
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
   * Like {@link verifyConnectivity} but only probes the first pool (cold start ok).
   */
  async probeFirstPool(): Promise<boolean> {
    const first = this.pools.values().next().value as Sql | undefined;
    if (!first) {
      return true;
    }
    try {
      await first`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true when there are no pools yet, or at least one tenant pool answers `SELECT 1`.
   */
  async verifyConnectivity(): Promise<boolean> {
    if (this.pools.size === 0) {
      return true;
    }
    for (const poolSql of this.pools.values()) {
      try {
        await poolSql`SELECT 1`;
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
