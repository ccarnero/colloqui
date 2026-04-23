import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";
import { ADAPTER_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/**
 * Per-tenant Postgres connection manager for adapter-service.
 *
 * Each tenant has its own Postgres instance provisioned by `tenant-service`
 * in its own Kubernetes namespace. `ADAPTER_SCHEMA_SQL` is baked into that
 * tenant's `init.sql` ConfigMap at provisioning time, but we also register
 * it here via `setSchema()` so that tenants provisioned before this change
 * get the tables lazily on first access (idempotent via `IF NOT EXISTS`).
 *
 * Pool cache, schema init deduplication, and connection lifecycle are
 * inherited from `@yoizen/database` `TenantConnectionManager`:
 * `ensureSchema(tenantId)` runs DDL once per tenant (O(1) amortised) and
 * returns a memoised `Sql` handle.
 */
@Injectable()
export class AdapterTenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.setSchema([ADAPTER_SCHEMA_SQL]);
  }
}
