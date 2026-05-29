import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { MongoClient, type Db } from "mongodb";
import { requireEnv } from "./require-env";
import { isFatalMongoError } from "./mongo-errors";
import { applyMongoSchema } from "./mongo-schema-applier";
import {
  TenantDatabaseTier,
  isTenantDatabaseTier,
  tenantPostgresDatabaseName,
  tenantPostgresRoleName,
  type IMongoCollectionSchema,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import {
  SharedTenantDatabaseMode,
  type ITenantConnectionManagerOptions,
  type ITenantDatabaseTarget,
  type SharedTenantDatabaseModeValue,
} from "./tenant-connection-manager";

export type ITenantMongoConnectionManagerOptions = ITenantConnectionManagerOptions;

export type {
  ITenantDatabaseTarget,
  SharedTenantDatabaseModeValue,
};
export { SharedTenantDatabaseMode };

interface IResolvedTenantMongoDatabase extends ITenantDatabaseTarget {
  readonly username: string;
  readonly password: string;
  readonly poolKey: string;
  readonly schemaKey: string;
  readonly uri: string;
}

const DEFAULT_SERVICE_NAME = "mongo";
const DEFAULT_DATABASE = "yoizen";
const DEFAULT_USERNAME = "yoizen";
const DEFAULT_PORT = 27017;
const SHARED_USAGE_DATABASE = "yoizen_usage";

const PROBE_TIMEOUT_MS =
  Number(process.env.TENANT_POOL_PROBE_TIMEOUT_MS) || 2_000;

const CLIENT_CLOSE_TIMEOUT_MS =
  Number(process.env.TENANT_POOL_END_TIMEOUT_MS) || 5_000;

const PROBE_TIMEOUT_ERROR: { readonly __probeTimeout: true } = Object.freeze({
  __probeTimeout: true as const,
});

function isProbeTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { __probeTimeout?: unknown }).__probeTimeout === true
  );
}

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

function encodeCredential(value: string): string {
  return encodeURIComponent(value);
}

function buildTenantMongoUri(input: {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
}): string {
  const user = encodeCredential(input.username);
  const password = encodeCredential(input.password);
  return `mongodb://${user}:${password}@${input.host}:${input.port}/${input.database}?authSource=admin`;
}

@Injectable()
export class TenantMongoConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantMongoConnectionManager.name);
  private readonly clients = new Map<string, MongoClient>();
  private readonly knownTenantIds = new Set<string>();
  private readonly initialized = new Set<string>();
  private readonly namespaceInitialized = new Map<string, Set<string>>();
  private schemaDescriptors: IMongoCollectionSchema[] = [];
  private schemaInitializer:
    | ((tenantId: string, db: Db) => Promise<void>)
    | null = null;
  private readonly pendingSchemaInit = new Map<string, Promise<void>>();
  private readonly tierCache = new Map<string, TenantDatabaseTierValue>();
  private readonly tierOverrides = parseTierOverrides(
    process.env.TENANT_MONGO_TIER_OVERRIDES ??
      process.env.TENANT_POSTGRES_TIER_OVERRIDES,
  );
  private catalogClient: MongoClient | null = null;
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

  constructor() {
    this.serviceName =
      process.env.MONGO_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;
    this.port = Number(process.env.MONGO_PORT) || DEFAULT_PORT;
    this.username = process.env.MONGO_USER ?? DEFAULT_USERNAME;
    this.password =
      process.env.MONGO_PASSWORD ?? requireEnv("MONGO_PASSWORD");
    this.database = process.env.MONGO_DB ?? DEFAULT_DATABASE;
    this.defaultTier = readTenantTier(
      process.env.TENANT_MONGO_DEFAULT_TIER ??
        process.env.TENANT_POSTGRES_DEFAULT_TIER,
      TenantDatabaseTier.Shared,
    );
    this.sharedHost =
      process.env.TENANT_MONGO_SHARED_HOST ??
      process.env.TENANT_POSTGRES_SHARED_HOST ??
      `mongo-shared.support-services-${this.env}.svc.cluster.local`;
    this.sharedPort =
      Number(
        process.env.TENANT_MONGO_SHARED_PORT ??
          process.env.TENANT_POSTGRES_SHARED_PORT,
      ) || DEFAULT_PORT;
    this.sharedUsername =
      process.env.TENANT_MONGO_SHARED_USER ??
      process.env.TENANT_POSTGRES_SHARED_USER ??
      null;
    this.sharedPassword =
      process.env.TENANT_MONGO_SHARED_PASSWORD ??
      process.env.TENANT_POSTGRES_SHARED_PASSWORD ??
      this.password;
    this.sharedDatabaseMode = readSharedDatabaseMode(
      process.env.TENANT_MONGO_SHARED_DATABASE_MODE ??
        process.env.TENANT_POSTGRES_SHARED_DATABASE_MODE,
      SharedTenantDatabaseMode.PerTenantDatabase,
    );
    this.sharedDatabase =
      process.env.TENANT_MONGO_SHARED_DATABASE ??
      process.env.TENANT_POSTGRES_SHARED_DATABASE ??
      SHARED_USAGE_DATABASE;
    this.catalogHost =
      process.env.TENANT_MONGO_CATALOG_HOST ??
      process.env.TENANT_POSTGRES_CATALOG_HOST ??
      process.env.MONGO_HOST ??
      `mongo.support-services-${this.env}.svc.cluster.local`;
    this.catalogPort =
      Number(
        process.env.TENANT_MONGO_CATALOG_PORT ??
          process.env.TENANT_POSTGRES_CATALOG_PORT,
      ) || this.port;
    this.catalogDatabase =
      process.env.TENANT_MONGO_CATALOG_DB ??
      process.env.TENANT_POSTGRES_CATALOG_DB ??
      this.database;
    this.catalogUsername =
      process.env.TENANT_MONGO_CATALOG_USER ??
      process.env.TENANT_POSTGRES_CATALOG_USER ??
      this.username;
    this.catalogPassword =
      process.env.TENANT_MONGO_CATALOG_PASSWORD ??
      process.env.TENANT_POSTGRES_CATALOG_PASSWORD ??
      this.password;
  }

  protected configure(options: ITenantMongoConnectionManagerOptions): void {
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

  setSchema(schemas: IMongoCollectionSchema[]): void {
    this.schemaDescriptors = schemas;
  }

  setSchemaInitializer(fn: (tenantId: string, db: Db) => Promise<void>): void {
    this.schemaInitializer = fn;
  }

  getKnownTenantIds(): string[] {
    return Array.from(this.knownTenantIds);
  }

  async ensureSchema(tenantId: string): Promise<Db> {
    const target = await this.resolveTenantDatabase(tenantId);
    const client = this.getOrCreateClient(tenantId, target);
    const db = client.db(target.database);
    if (this.initialized.has(target.schemaKey)) {
      return db;
    }

    const pending = this.pendingSchemaInit.get(target.schemaKey);
    if (pending) {
      await pending;
      return db;
    }

    const work = this.runTenantSchemaInit(tenantId, target.schemaKey, db);
    this.pendingSchemaInit.set(target.schemaKey, work);
    try {
      await work;
    } finally {
      this.pendingSchemaInit.delete(target.schemaKey);
    }
    return db;
  }

  async resolveDatabaseTarget(
    tenantId: string,
  ): Promise<ITenantDatabaseTarget> {
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
    db: Db,
  ): Promise<void> {
    if (this.initialized.has(schemaKey)) {
      return;
    }
    const hasStatic = this.schemaDescriptors.length > 0;
    const hasAsyncInit = this.schemaInitializer !== null;
    if (!hasStatic && !hasAsyncInit) {
      return;
    }
    if (hasStatic) {
      await applyMongoSchema(db, this.schemaDescriptors);
    }
    if (this.schemaInitializer) {
      await this.schemaInitializer(tenantId, db);
    }
    this.initialized.add(schemaKey);
    this.logger.log(`Mongo schema initialized for tenant '${tenantId}'`);
  }

  getConnection(tenantId: string): Db {
    const tier = this.resolveTenantTierSync(tenantId);
    const target =
      tier === TenantDatabaseTier.Dedicated
        ? this.buildDedicatedTarget(tenantId)
        : this.buildSharedTarget(tenantId);
    return this.getOrCreateClient(tenantId, target).db(target.database);
  }

  getClient(tenantId: string): MongoClient {
    const tier = this.resolveTenantTierSync(tenantId);
    const target =
      tier === TenantDatabaseTier.Dedicated
        ? this.buildDedicatedTarget(tenantId)
        : this.buildSharedTarget(tenantId);
    return this.getOrCreateClient(tenantId, target);
  }

  private async resolveTenantDatabase(
    tenantId: string,
  ): Promise<IResolvedTenantMongoDatabase> {
    const tier = await this.resolveTenantTier(tenantId);
    if (tier === TenantDatabaseTier.Dedicated) {
      return this.buildDedicatedTarget(tenantId);
    }
    return this.buildSharedTarget(tenantId);
  }

  private buildDedicatedTarget(
    tenantId: string,
  ): IResolvedTenantMongoDatabase {
    const host = `${this.serviceName}.${tenantId}-${this.env}-ns.svc.cluster.local`;
    const uri = buildTenantMongoUri({
      host,
      port: this.port,
      database: this.database,
      username: this.username,
      password: this.password,
    });
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
      uri,
    };
  }

  private buildSharedTarget(tenantId: string): IResolvedTenantMongoDatabase {
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
    const uri = buildTenantMongoUri({
      host: this.sharedHost,
      port: this.sharedPort,
      database,
      username,
      password: this.sharedPassword,
    });

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
      uri,
    };
  }

  private getOrCreateClient(
    tenantId: string,
    target: IResolvedTenantMongoDatabase,
  ): MongoClient {
    this.knownTenantIds.add(tenantId);
    const existing = this.clients.get(target.poolKey);
    if (existing) return existing;

    const client = new MongoClient(target.uri, { maxPoolSize: 10 });
    this.clients.set(target.poolKey, client);
    this.logger.log(
      `Created ${target.tier} Mongo client for tenant '${tenantId}' -> ${target.host}/${target.database}`,
    );
    return client;
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
    return this.defaultTier;
  }

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

  protected async lookupTenantTier(
    tenantId: string,
  ): Promise<TenantDatabaseTierValue | null> {
    try {
      const client = this.getCatalogClient();
      const db = client.db(this.catalogDatabase);
      const row = await db.collection("tenants").findOne(
        { name: tenantId },
        { projection: { tier: 1 } },
      );
      if (
        row !== null &&
        typeof row.tier === "string" &&
        isTenantDatabaseTier(row.tier)
      ) {
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

  private getCatalogClient(): MongoClient {
    if (this.catalogClient) return this.catalogClient;
    const uri = buildTenantMongoUri({
      host: this.catalogHost,
      port: this.catalogPort,
      database: this.catalogDatabase,
      username: this.catalogUsername,
      password: this.catalogPassword,
    });
    this.catalogClient = new MongoClient(uri, { maxPoolSize: 2 });
    return this.catalogClient;
  }

  isInitialized(tenantId: string): boolean {
    return this.initialized.has(tenantId);
  }

  markInitialized(tenantId: string): void {
    this.initialized.add(tenantId);
  }

  isNamespaceInitialized(namespace: string, tenantId: string): boolean {
    const set = this.namespaceInitialized.get(namespace);
    return set !== undefined && set.has(tenantId);
  }

  markNamespaceInitialized(namespace: string, tenantId: string): void {
    let set = this.namespaceInitialized.get(namespace);
    if (set === undefined) {
      set = new Set<string>();
      this.namespaceInitialized.set(namespace, set);
    }
    set.add(tenantId);
  }

  async probeFirstPool(): Promise<boolean> {
    const first = this.clients.values().next().value as MongoClient | undefined;
    if (!first) {
      return true;
    }
    try {
      await this.probeWithTimeout(first);
      return true;
    } catch (err: unknown) {
      if (isProbeTimeout(err)) {
        this.evictBrokenClients([first]);
      } else {
        this.evictClientIfFatal(first, err);
      }
      return false;
    }
  }

  async verifyConnectivity(): Promise<boolean> {
    if (this.clients.size === 0) {
      return true;
    }

    const probes = Array.from(this.clients.values()).map(async (client) => {
      try {
        await this.probeWithTimeout(client);
        return { client, ok: true, broken: false };
      } catch (err: unknown) {
        const broken = isFatalMongoError(err) || isProbeTimeout(err);
        return { client, ok: false, broken };
      }
    });

    const settled = await Promise.all(probes);

    let healthyFound = false;
    const broken: MongoClient[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      if (result.ok) {
        healthyFound = true;
      } else if (result.broken) {
        broken.push(result.client);
      }
    }
    if (broken.length > 0) {
      this.evictBrokenClients(broken);
    }
    return healthyFound;
  }

  private async probeWithTimeout(client: MongoClient): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        client.db("admin").command({ ping: 1 }).then(
          () => undefined,
          (err: unknown) => {
            throw err;
          },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(PROBE_TIMEOUT_ERROR), PROBE_TIMEOUT_MS);
          if (typeof timer.unref === "function") timer.unref();
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async evictTenant(tenantId: string): Promise<void> {
    const dedicatedPrefix = `dedicated:${tenantId}:`;
    const sharedTenantPrefix = `shared-tenant:${tenantId}:`;

    const closing: Promise<void>[] = [];
    for (const [poolKey, client] of this.clients) {
      if (
        poolKey.startsWith(dedicatedPrefix) ||
        poolKey.startsWith(sharedTenantPrefix)
      ) {
        this.clients.delete(poolKey);
        closing.push(this.closeClientSafely(client, poolKey));
      }
    }

    this.clearTenantInitBookkeeping(tenantId);

    if (closing.length > 0) {
      await Promise.allSettled(closing);
      this.logger.log(
        `Evicted ${closing.length} Mongo client(s) for tenant '${tenantId}' after deletion event`,
      );
    }
  }

  private async closeClientSafely(
    client: MongoClient,
    poolKey: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        client.close(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLIENT_CLOSE_TIMEOUT_MS);
          if (typeof timer.unref === "function") timer.unref();
        }),
      ]);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `client.close failed for '${poolKey}' (continuing eviction): ${detail}`,
      );
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  private evictBrokenClients(broken: readonly MongoClient[]): void {
    const removedKeys: string[] = [];
    for (const dead of broken) {
      for (const [key, client] of this.clients) {
        if (client === dead) {
          this.clients.delete(key);
          removedKeys.push(key);
          break;
        }
      }
    }
    if (removedKeys.length === 0) return;
    for (let i = 0; i < broken.length; i++) {
      void this.closeClientSafely(broken[i]!, removedKeys[i] ?? "<unknown>");
    }
    const clearedTenants = new Set<string>();
    for (const key of removedKeys) {
      this.initialized.delete(key);
      this.pendingSchemaInit.delete(key);
      const tenantId = this.extractTenantIdFromPoolKey(key);
      if (tenantId !== null) {
        clearedTenants.add(tenantId);
      }
    }
    for (const tenantId of clearedTenants) {
      this.clearTenantInitBookkeeping(tenantId);
    }
    this.logger.warn(
      `Self-healed ${removedKeys.length} broken Mongo client(s); next request will reopen on demand: ${removedKeys.join(", ")}`,
    );
  }

  /**
   * Clears per-tenant init flags and tier cache so the next request re-resolves
   * placement from the platform catalog instead of stale dedicated routing.
   */
  private clearTenantInitBookkeeping(tenantId: string): void {
    const dedicatedSchemaPrefix = `dedicated:${tenantId}:`;
    const sharedTenantSchemaPrefix = `shared-tenant:${tenantId}:`;

    for (const schemaKey of [...this.initialized]) {
      if (
        schemaKey.startsWith(dedicatedSchemaPrefix) ||
        schemaKey.startsWith(sharedTenantSchemaPrefix)
      ) {
        this.initialized.delete(schemaKey);
      }
    }
    this.initialized.delete(tenantId);
    for (const schemaKey of [...this.pendingSchemaInit.keys()]) {
      if (
        schemaKey.startsWith(dedicatedSchemaPrefix) ||
        schemaKey.startsWith(sharedTenantSchemaPrefix)
      ) {
        this.pendingSchemaInit.delete(schemaKey);
      }
    }
    for (const [namespace, set] of this.namespaceInitialized) {
      if (set.delete(tenantId) && set.size === 0) {
        this.namespaceInitialized.delete(namespace);
      }
    }

    this.knownTenantIds.delete(tenantId);
    this.tierCache.delete(tenantId);
  }

  private extractTenantIdFromPoolKey(poolKey: string): string | null {
    if (
      poolKey.startsWith("dedicated:") ||
      poolKey.startsWith("shared-tenant:")
    ) {
      const colon = poolKey.indexOf(":", poolKey.indexOf(":") + 1);
      if (colon === -1) {
        return null;
      }
      return poolKey.slice(poolKey.indexOf(":") + 1, colon);
    }
    return null;
  }

  private evictClientIfFatal(client: MongoClient, err: unknown): void {
    if (!isFatalMongoError(err)) return;
    this.evictBrokenClients([client]);
  }

  async onModuleDestroy(): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const [key, client] of this.clients) {
      closing.push(this.closeClientSafely(client, key));
    }
    if (this.catalogClient) {
      closing.push(this.closeClientSafely(this.catalogClient, "<catalog>"));
      this.catalogClient = null;
    }
    if (closing.length > 0) {
      await Promise.allSettled(closing);
    }
    this.clients.clear();
    this.knownTenantIds.clear();
    this.initialized.clear();
    this.namespaceInitialized.clear();
    this.tierCache.clear();
  }
}
