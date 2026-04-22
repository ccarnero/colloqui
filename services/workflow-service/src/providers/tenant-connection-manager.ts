import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";
import { WORKFLOW_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/**
 * Per-tenant Postgres connection manager for workflow-service.
 *
 * Each tenant has its own Postgres instance provisioned by `tenant-service`
 * in its own Kubernetes namespace. `WORKFLOW_SCHEMA_SQL` is baked into that
 * tenant's `init.sql` ConfigMap at provisioning time, but we also register
 * it here via `setSchema()` so that tenants provisioned before this change
 * get the tables lazily on first access (idempotent via `IF NOT EXISTS`).
 */
@Injectable()
export class WorkflowTenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.setSchema([WORKFLOW_SCHEMA_SQL]);
  }
}
