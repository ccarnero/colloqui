import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";
import { CHANNEL_USAGE_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/**
 * Read-path connection manager targeting the **usage** TimescaleDB
 * instance (`postgres-usage` service in each tenant namespace).
 *
 * Provisioning writes first via `usage-aggregator-service`, so in
 * steady state the schema is already there; we still register the
 * idempotent DDL so a fresh tenant querying the UI *before* the
 * aggregator has flushed any data sees an empty table rather than a
 * 42P01 error.
 */
@Injectable()
export class UsageTenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.configure({ serviceName: "postgres-usage" });
    this.setSchema([CHANNEL_USAGE_SCHEMA_SQL]);
  }
}
