import type { Sql } from "@yoizen/database";
import { TenantConnectionManager } from "@yoizen/database";

/**
 * Base for per-tenant repositories: shared schema ensure + connection lookup.
 */
export abstract class TenantScopedRepository {
  protected constructor(
    protected readonly connectionManager: TenantConnectionManager,
  ) {}

  protected async getSql(tenantId: string): Promise<Sql> {
    await this.connectionManager.ensureSchema(tenantId);
    return this.connectionManager.getConnection(tenantId);
  }
}
