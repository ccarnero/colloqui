import type {
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";

export abstract class TenantScopedPostgresRepository {
  protected constructor(
    protected readonly connectionManager: TenantConnectionManager,
  ) {}

  protected async getSql(tenantId: string) {
    return this.connectionManager.ensureSchema(tenantId);
  }
}

export abstract class TenantScopedMongoRepository {
  protected constructor(
    protected readonly connectionManager: TenantMongoConnectionManager,
  ) {}

  protected async getDb(tenantId: string) {
    return this.connectionManager.ensureSchema(tenantId);
  }
}
