import { Injectable } from "@nestjs/common";
import { TenantConnectionManager } from "@yoizen/database";
import { ADAPTER_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/**
 * Per-tenant Postgres connection manager for connector-admin.
 */
@Injectable()
export class AdapterTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.setSchema([ADAPTER_SCHEMA_SQL]);
  }
}
