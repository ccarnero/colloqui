import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import postgres from "postgres";
import type { Sql } from "./types";
import { requireEnv } from "./require-env";

/**
 * Optional constructor overrides for {@link TenantConnectionManager}
 * subclasses that need to point at a **different** per-tenant Postgres
 * flavour than the default (`postgres` service, main OLTP DB).
 *
 * Primary motivation: the dedicated `postgres-usage` TimescaleDB
 * instance provisioned alongside the main tenant DB — a subclass
 * passes `{ serviceName: "postgres-usage" }` and gets correctly
 * addressed pools without touching the rest of the class.
 *
 * All fields fall back to env-vars first (so ops can override per
 * deployment without code changes) and then to legacy defaults, so
 * zero-arg `super()` callers preserve exact pre-existing behavior.
 */
export interface ITenantConnectionManagerOptions {
  /** Kubernetes Service hostname for the tenant Postgres. Default `postgres`. */
  readonly serviceName?: string;
  /** Override TCP port. Falls back to `POSTGRES_PORT` env then `5432`. */
  readonly port?: number;
  /** Override username. Falls back to `POSTGRES_USER` env then `yoizen`. */
  readonly username?: string;
  /** Override password. Falls back to `POSTGRES_PASSWORD` (required). */
  readonly password?: string;
  /** Override DB name. Falls back to `yoizen`. */
  readonly database?: string;
}

const DEFAULT_SERVICE_NAME = "postgres";
const DEFAULT_DATABASE = "yoizen";
const DEFAULT_USERNAME = "yoizen";
const DEFAULT_PORT = 5432;

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly initialized = new Set<string>();
  private schemaSql: string[] = [];
  private schemaInitializer: ((tenantId: string, sql: Sql) => Promise<void>) | null =
    null;
  private readonly pendingSchemaInit = new Map<string, Promise<void>>();

  protected serviceName: string;
  protected port: number;
  protected username: string;
  protected password: string;
  protected database: string;
  protected readonly env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

  /**
   * Parameter-less by design: Nest's DI reflects `design:paramtypes`
   * from the constructor signature, so adding an `options` arg here
   * would break every service that provides `TenantConnectionManager`
   * directly (it would try to inject `Object`). Subclasses that need
   * to point at a non-default Postgres flavour (e.g. `postgres-usage`)
   * call {@link configure} inside their own constructor **before any
   * pool is opened** (pool creation is lazy in {@link getConnection}).
   */
  constructor() {
    this.serviceName =
      process.env.POSTGRES_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;
    this.port = Number(process.env.POSTGRES_PORT) || DEFAULT_PORT;
    this.username = process.env.POSTGRES_USER ?? DEFAULT_USERNAME;
    this.password = requireEnv("POSTGRES_PASSWORD");
    this.database = process.env.POSTGRES_DB ?? DEFAULT_DATABASE;
  }

  /**
   * Applies non-default connection settings. Must be called from a
   * subclass constructor before any tenant pool is created; mutating
   * these fields later would leave already-open pools pointing at
   * stale hosts/credentials.
   */
  protected configure(options: ITenantConnectionManagerOptions): void {
    if (options.serviceName !== undefined) {
      this.serviceName = options.serviceName;
    }
    if (options.port !== undefined) {
      this.port = options.port;
    }
    if (options.username !== undefined) {
      this.username = options.username;
    }
    if (options.password !== undefined) {
      this.password = options.password;
    }
    if (options.database !== undefined) {
      this.database = options.database;
    }
  }

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

    const host = `${this.serviceName}.${tenantId}-${this.env}-ns.svc.cluster.local`;
    const pool = postgres({
      host,
      port: this.port,
      database: this.database,
      username: this.username,
      password: this.password,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 30,
    });
    this.pools.set(tenantId, pool);
    this.logger.log(
      `Created connection pool for tenant '${tenantId}' -> ${host}/${this.database}`,
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
