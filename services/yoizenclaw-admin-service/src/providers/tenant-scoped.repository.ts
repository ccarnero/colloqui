import type {
  Db,
  Sql,
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";

/** Base for per-tenant Postgres repositories. */
export abstract class TenantScopedPostgresRepository {
  protected constructor(
    protected readonly connectionManager: TenantConnectionManager,
  ) {}

  protected async getSql(tenantId: string): Promise<Sql> {
    return this.connectionManager.ensureSchema(tenantId);
  }
}

/** Base for per-tenant Mongo repositories. */
export abstract class TenantScopedMongoRepository {
  protected constructor(
    protected readonly connectionManager: TenantMongoConnectionManager,
  ) {}

  protected async getDb(tenantId: string): Promise<Db> {
    return this.connectionManager.ensureSchema(tenantId);
  }
}
