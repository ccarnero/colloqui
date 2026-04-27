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
 * Per-tenant connection manager pointing at the **dedicated**
 * `postgres-usage` TimescaleDB instance provisioned by tenant-service
 * (see `TenantUsagePostgresProvisioner`). Lazy-initialises the
 * `channel_events` hypertable + continuous aggregates the first time
 * a tenant's pool is touched — schema DDL is idempotent so repeated
 * invocations are cheap.
 *
 * All pool caching, `ensureSchema` deduplication and teardown are
 * inherited from `@yoizen/database` `TenantConnectionManager`.
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
