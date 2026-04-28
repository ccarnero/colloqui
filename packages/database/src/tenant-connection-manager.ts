import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import postgres from "postgres";
import type { Sql } from "./types";
import { requireEnv } from "./require-env";
import {
  TenantDatabaseTier,
  isTenantDatabaseTier,
  tenantPostgresDatabaseName,
  tenantPostgresRoleName,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";

export const SharedTenantDatabaseMode = {
  PerTenantDatabase: "per-tenant-database",
  SingleDatabase: "single-database",
} as const;

export type SharedTenantDatabaseModeValue =
  (typeof SharedTenantDatabaseMode)[keyof typeof SharedTenantDatabaseMode];

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
  /** Default placement when platform catalog lookup is unavailable. */
  readonly defaultTier?: TenantDatabaseTierValue;
  /** Host for shared tenant databases. */
  readonly sharedHost?: string;
  /** Port for shared tenant databases. */
  readonly sharedPort?: number;
  /** Fixed shared DB user. If unset, OLTP shared DBs use per-tenant role names. */
  readonly sharedUsername?: string;
  /** Password for shared DB access. Falls back to `POSTGRES_PASSWORD`. */
  readonly sharedPassword?: string;
  /** Shared database layout. OLTP uses one DB per tenant; usage uses one DB for all tenants. */
  readonly sharedDatabaseMode?: SharedTenantDatabaseModeValue;
  /** Fixed shared database name when `sharedDatabaseMode` is `single-database`. */
  readonly sharedDatabase?: string;
  /** Platform catalog host for resolving `tenants.tier`. */
  readonly catalogHost?: string;
  /** Platform catalog port for resolving `tenants.tier`. */
  readonly catalogPort?: number;
  /** Platform catalog database for resolving `tenants.tier`. */
  readonly catalogDatabase?: string;
  /** Platform catalog username for resolving `tenants.tier`. */
  readonly catalogUsername?: string;
  /** Platform catalog password for resolving `tenants.tier`. */
  readonly catalogPassword?: string;
}

export interface ITenantDatabaseTarget {
  readonly tier: TenantDatabaseTierValue;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly sharedDatabaseMode: SharedTenantDatabaseModeValue | null;
}

interface IResolvedTenantDatabase extends ITenantDatabaseTarget {
  readonly username: string;
  readonly password: string;
  readonly poolKey: string;
  readonly schemaKey: string;
}

const DEFAULT_SERVICE_NAME = "postgres";
const DEFAULT_DATABASE = "yoizen";
const DEFAULT_USERNAME = "yoizen";
const DEFAULT_PORT = 5432;
const SHARED_USAGE_DATABASE = "yoizen_usage";

function readTenantTier(
  value: string | undefined,
  fallback: TenantDatabaseTierValue,
): TenantDatabaseTierValue {
  return value !== undefined && isTenantDatabaseTier(value) ? value : fallback;
}

function readSharedDatabaseMode(
  value: string | undefined,
  fallback: SharedTenantDatabaseModeValue,
): SharedTenantDatabaseModeValue {
  if (value === SharedTenantDatabaseMode.SingleDatabase) {
    return SharedTenantDatabaseMode.SingleDatabase;
  }
  if (value === SharedTenantDatabaseMode.PerTenantDatabase) {
    return SharedTenantDatabaseMode.PerTenantDatabase;
  }
  return fallback;
}

function parseTierOverrides(
  raw: string | undefined,
): ReadonlyMap<string, TenantDatabaseTierValue> {
  const out = new Map<string, TenantDatabaseTierValue>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [tenantId, value] of Object.entries(parsed)) {
      if (typeof value === "string" && isTenantDatabaseTier(value)) {
        out.set(tenantId, value);
      }
    }
  } catch {
    return out;
  }
  return out;
}

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly knownTenantIds = new Set<string>();
  private readonly initialized = new Set<string>();
  private schemaSql: string[] = [];
  private schemaInitializer: ((tenantId: string, sql: Sql) => Promise<void>) | null =
    null;
  private readonly pendingSchemaInit = new Map<string, Promise<void>>();
  private readonly tierCache = new Map<string, TenantDatabaseTierValue>();
  private readonly tierOverrides = parseTierOverrides(
    process.env.TENANT_POSTGRES_TIER_OVERRIDES,
  );
  private catalogSql: Sql | null = null;
  private catalogLookupWarned = false;

  protected serviceName: string;
  protected port: number;
  protected username: string;
  protected password: string;
  protected database: string;
  protected readonly env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
  protected defaultTier: TenantDatabaseTierValue;
  protected sharedHost: string;
  protected sharedPort: number;
  protected sharedUsername: string | null;
  protected sharedPassword: string;
  protected sharedDatabaseMode: SharedTenantDatabaseModeValue;
  protected sharedDatabase: string;
  protected catalogHost: string;
  protected catalogPort: number;
  protected catalogDatabase: string;
  protected catalogUsername: string;
  protected catalogPassword: string;

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
    this.defaultTier = readTenantTier(
      process.env.TENANT_POSTGRES_DEFAULT_TIER,
      TenantDatabaseTier.Shared,
    );
    this.sharedHost =
      process.env.TENANT_POSTGRES_SHARED_HOST ??
      `postgres-shared.support-services-${this.env}.svc.cluster.local`;
    this.sharedPort =
      Number(process.env.TENANT_POSTGRES_SHARED_PORT) || DEFAULT_PORT;
    this.sharedUsername = process.env.TENANT_POSTGRES_SHARED_USER ?? null;
    this.sharedPassword =
      process.env.TENANT_POSTGRES_SHARED_PASSWORD ?? this.password;
    this.sharedDatabaseMode = readSharedDatabaseMode(
      process.env.TENANT_POSTGRES_SHARED_DATABASE_MODE,
      SharedTenantDatabaseMode.PerTenantDatabase,
    );
    this.sharedDatabase =
      process.env.TENANT_POSTGRES_SHARED_DATABASE ?? SHARED_USAGE_DATABASE;
    this.catalogHost =
      process.env.TENANT_POSTGRES_CATALOG_HOST ??
      process.env.POSTGRES_HOST ??
      `postgres.support-services-${this.env}.svc.cluster.local`;
    this.catalogPort =
      Number(process.env.TENANT_POSTGRES_CATALOG_PORT) || this.port;
    this.catalogDatabase =
      process.env.TENANT_POSTGRES_CATALOG_DB ?? this.database;
    this.catalogUsername =
      process.env.TENANT_POSTGRES_CATALOG_USER ?? this.username;
    this.catalogPassword =
      process.env.TENANT_POSTGRES_CATALOG_PASSWORD ?? this.password;
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
    if (options.defaultTier !== undefined) {
      this.defaultTier = options.defaultTier;
    }
    if (options.sharedHost !== undefined) {
      this.sharedHost = options.sharedHost;
    }
    if (options.sharedPort !== undefined) {
      this.sharedPort = options.sharedPort;
    }
    if (options.sharedUsername !== undefined) {
      this.sharedUsername = options.sharedUsername;
    }
    if (options.sharedPassword !== undefined) {
      this.sharedPassword = options.sharedPassword;
    }
    if (options.sharedDatabaseMode !== undefined) {
      this.sharedDatabaseMode = options.sharedDatabaseMode;
    }
    if (options.sharedDatabase !== undefined) {
      this.sharedDatabase = options.sharedDatabase;
    }
    if (options.catalogHost !== undefined) {
      this.catalogHost = options.catalogHost;
    }
    if (options.catalogPort !== undefined) {
      this.catalogPort = options.catalogPort;
    }
    if (options.catalogDatabase !== undefined) {
      this.catalogDatabase = options.catalogDatabase;
    }
    if (options.catalogUsername !== undefined) {
      this.catalogUsername = options.catalogUsername;
    }
    if (options.catalogPassword !== undefined) {
      this.catalogPassword = options.catalogPassword;
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
    return Array.from(this.knownTenantIds);
  }

  /**
   * Returns the connection for `tenantId`, lazily running registered
   * schema DDL if this tenant has not been initialized yet.
   */
  async ensureSchema(tenantId: string): Promise<Sql> {
    const target = await this.resolveTenantDatabase(tenantId);
    const sql = this.getOrCreatePool(tenantId, target);
    if (this.initialized.has(target.schemaKey)) {
      return sql;
    }

    const pending = this.pendingSchemaInit.get(target.schemaKey);
    if (pending) {
      await pending;
      return sql;
    }

    const work = this.runTenantSchemaInit(tenantId, target.schemaKey, sql);
    this.pendingSchemaInit.set(target.schemaKey, work);
    try {
      await work;
    } finally {
      this.pendingSchemaInit.delete(target.schemaKey);
    }
    return sql;
  }

  async resolveDatabaseTarget(tenantId: string): Promise<ITenantDatabaseTarget> {
    const target = await this.resolveTenantDatabase(tenantId);
    return {
      tier: target.tier,
      host: target.host,
      port: target.port,
      database: target.database,
      sharedDatabaseMode: target.sharedDatabaseMode,
    };
  }

  private async runTenantSchemaInit(
    tenantId: string,
    schemaKey: string,
    sql: Sql,
  ): Promise<void> {
    if (this.initialized.has(schemaKey)) {
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
    this.initialized.add(schemaKey);
    this.logger.log(`Schema initialized for tenant '${tenantId}'`);
  }

  getConnection(tenantId: string): Sql {
    const tier = this.resolveTenantTierSync(tenantId);
    const target =
      tier === TenantDatabaseTier.Dedicated
        ? this.buildDedicatedTarget(tenantId)
        : this.buildSharedTarget(tenantId);
    return this.getOrCreatePool(tenantId, target);
  }

  private async resolveTenantDatabase(
    tenantId: string,
  ): Promise<IResolvedTenantDatabase> {
    const tier = await this.resolveTenantTier(tenantId);
    if (tier === TenantDatabaseTier.Dedicated) {
      return this.buildDedicatedTarget(tenantId);
    }
    return this.buildSharedTarget(tenantId);
  }

  private buildDedicatedTarget(tenantId: string): IResolvedTenantDatabase {
    const host = `${this.serviceName}.${tenantId}-${this.env}-ns.svc.cluster.local`;
    return {
      tier: TenantDatabaseTier.Dedicated,
      host,
      port: this.port,
      database: this.database,
      username: this.username,
      password: this.password,
      poolKey: `dedicated:${tenantId}:${this.serviceName}`,
      schemaKey: `dedicated:${tenantId}:${this.database}`,
      sharedDatabaseMode: null,
    };
  }

  private buildSharedTarget(tenantId: string): IResolvedTenantDatabase {
    const database =
      this.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
        ? this.sharedDatabase
        : tenantPostgresDatabaseName(tenantId);
    const username =
      this.sharedUsername ??
      (this.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
        ? this.username
        : tenantPostgresRoleName(tenantId));
    const poolKey =
      this.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
        ? `shared-single:${this.sharedHost}:${database}:${username}`
        : `shared-tenant:${tenantId}:${database}:${username}`;
    const schemaKey =
      this.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
        ? `shared-single:${database}`
        : `shared-tenant:${tenantId}:${database}`;

    return {
      tier: TenantDatabaseTier.Shared,
      host: this.sharedHost,
      port: this.sharedPort,
      database,
      username,
      password: this.sharedPassword,
      poolKey,
      schemaKey,
      sharedDatabaseMode: this.sharedDatabaseMode,
    };
  }

  private getOrCreatePool(
    tenantId: string,
    target: IResolvedTenantDatabase,
  ): Sql {
    this.knownTenantIds.add(tenantId);
    const existing = this.pools.get(target.poolKey);
    if (existing) return existing;

    const pool = postgres({
      host: target.host,
      port: target.port,
      database: target.database,
      username: target.username,
      password: target.password,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 30,
    });
    this.pools.set(target.poolKey, pool);
    this.logger.log(
      `Created ${target.tier} connection pool for tenant '${tenantId}' -> ${target.host}/${target.database}`,
    );
    return pool;
  }

  private async resolveTenantTier(
    tenantId: string,
  ): Promise<TenantDatabaseTierValue> {
    const override = this.tierOverrides.get(tenantId);
    if (override !== undefined) {
      this.tierCache.set(tenantId, override);
      return override;
    }

    const cached = this.tierCache.get(tenantId);
    if (cached !== undefined) return cached;

    const lookup = await this.lookupTenantTier(tenantId);
    if (lookup !== null) {
      this.tierCache.set(tenantId, lookup);
      return lookup;
    }
    // Catalog unreachable or tenant absent: return the default but DON'T
    // cache it. Caching here would permanently mis-route a tenant whose
    // first request hit a transient catalog outage; without caching, the
    // very next request retries the catalog and resolves correctly.
    return this.defaultTier;
  }

  /**
   * Routing for synchronous {@link getConnection}.
   *
   * Reads {@link tierCache} so that a {@link getConnection} call that
   * follows {@link ensureSchema} routes to the same tier the async
   * resolver already discovered. Without this, a caller that does
   * `await ensureSchema(t); getConnection(t)` would open two pools
   * (one per resolver) and the sync side would point at the wrong host
   * whenever the async resolver disagreed with `defaultTier`.
   *
   * Order of precedence: env override → resolved tier cache → defaultTier.
   *
   * `protected` (vs `private`) so tests can subclass and exercise the
   * resolver without opening a real Postgres pool through `getConnection`.
   */
  protected resolveTenantTierSync(tenantId: string): TenantDatabaseTierValue {
    const override = this.tierOverrides.get(tenantId);
    if (override !== undefined) {
      return override;
    }
    const cached = this.tierCache.get(tenantId);
    if (cached !== undefined) {
      return cached;
    }
    return this.defaultTier;
  }

  /**
   * Returns the tenant's tier from the platform catalog, or `null` when
   * the catalog is unreachable / has no row for the tenant. Returning
   * `null` (instead of {@link defaultTier}) lets the caller distinguish
   * "catalog says shared" from "catalog couldn't answer", and avoid
   * caching the latter.
   *
   * `protected` so tests can override with a deterministic stub instead
   * of standing up a real Postgres catalog.
   */
  protected async lookupTenantTier(
    tenantId: string,
  ): Promise<TenantDatabaseTierValue | null> {
    try {
      const [row] = await this.getCatalogSql()<{
        tier: string;
      }[]>`
        SELECT tier
        FROM tenants
        WHERE name = ${tenantId}
        LIMIT 1
      `;
      if (row && isTenantDatabaseTier(row.tier)) {
        return row.tier;
      }
    } catch (error: unknown) {
      if (!this.catalogLookupWarned) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Tenant tier lookup unavailable; using default '${this.defaultTier}': ${detail}`,
        );
        this.catalogLookupWarned = true;
      }
    }
    return null;
  }

  private getCatalogSql(): Sql {
    if (this.catalogSql) return this.catalogSql;
    this.catalogSql = postgres({
      host: this.catalogHost,
      port: this.catalogPort,
      database: this.catalogDatabase,
      username: this.catalogUsername,
      password: this.catalogPassword,
      max: 2,
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: true,
    });
    return this.catalogSql;
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
    if (this.catalogSql) {
      await this.catalogSql.end();
      this.catalogSql = null;
    }
    this.pools.clear();
    this.knownTenantIds.clear();
    this.initialized.clear();
    this.tierCache.clear();
  }
}
