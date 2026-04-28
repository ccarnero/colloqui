import type { Sql } from "@yoizen/database";
import { TenantConnectionManager } from "@yoizen/database";

/**
 * Base for per-tenant repositories: shared schema ensure + connection lookup.
 *
 * `ensureSchema` runs first to (a) trigger the async catalog-aware tier
 * resolver and (b) initialize the per-tenant schema. After that, the
 * synchronous `getConnection` reads the same tier from `tierCache`, so
 * both calls agree on the tier and reuse the single pool keyed by it.
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
