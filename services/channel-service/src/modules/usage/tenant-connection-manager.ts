import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager as BaseTenantConnectionManager,
} from "@yoizen/database";
import {
  CHANNEL_USAGE_SCHEMA_SQL,
  SHARED_CHANNEL_USAGE_SCHEMA_SQL,
} from "@yoizen/shared";

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
    this.configure({
      serviceName: "postgres-usage",
      sharedDatabaseMode: SharedTenantDatabaseMode.SingleDatabase,
      sharedDatabase: process.env.TENANT_POSTGRES_SHARED_USAGE_DB ?? "yoizen_usage",
      sharedUsername:
        process.env.TENANT_POSTGRES_SHARED_USAGE_USER ??
        process.env.TENANT_POSTGRES_SHARED_USER,
      sharedPassword:
        process.env.TENANT_POSTGRES_SHARED_USAGE_PASSWORD ??
        process.env.TENANT_POSTGRES_SHARED_PASSWORD,
    });
    this.setSchemaInitializer(async (tenantId, sql) => {
      const target = await this.resolveDatabaseTarget(tenantId);
      const schema =
        target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
          ? SHARED_CHANNEL_USAGE_SCHEMA_SQL
          : CHANNEL_USAGE_SCHEMA_SQL;
      await sql.unsafe(schema);
    });
  }
}
