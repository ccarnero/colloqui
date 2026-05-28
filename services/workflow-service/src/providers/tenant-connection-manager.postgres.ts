import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";
import { WORKFLOW_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/** Per-tenant Postgres for workflow definitions and executions. */
@Injectable()
export class WorkflowTenantConnectionManagerPostgres extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.setSchema([WORKFLOW_SCHEMA_SQL]);
  }
}
