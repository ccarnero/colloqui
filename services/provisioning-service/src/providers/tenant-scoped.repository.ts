import type { TenantConnectionManager } from "@yoizen/database";

export abstract class TenantScopedPostgresRepository {
  protected constructor(
    protected readonly connectionManager: TenantConnectionManager
  ) {}

  protected async getSql(tenantId: string) {
    return this.connectionManager.ensureSchema(tenantId);
  }
}
