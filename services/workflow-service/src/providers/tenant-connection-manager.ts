import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";
import { WORKFLOW_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/**
 * Per-tenant Postgres for workflow definitions/executions. Tier `dedicated`
 * uses the in-namespace `postgres` service; tier `shared` uses the
 * platform `postgres-shared` cluster (per-tenant database + role). Schema
 * is applied via `setSchema()` for lazy backfill (`IF NOT EXISTS`).
 */
@Injectable()
export class WorkflowTenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.setSchema([WORKFLOW_SCHEMA_SQL]);
  }
}
