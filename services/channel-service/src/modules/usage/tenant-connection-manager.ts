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
 * Read-path connection manager for the **usage** TimescaleDB tier.
 * Two physical layouts coexist behind one resolver:
 *
 * - **Dedicated** tenants → `postgres-usage` Service in the per-tenant
 *   namespace (provisioned by `TenantUsagePostgresProvisioner`).
 * - **Shared** tenants → the platform-wide `postgres-usage-shared`
 *   CloudNativePG cluster, in single-database mode (`yoizen_usage`).
 *
 * The base `TenantConnectionManager` defaults `sharedHost` to the OLTP
 * `postgres-shared` cluster — wrong for usage data — so we override it
 * here to land on `postgres-usage-shared`.
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
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    this.configure({
      serviceName: "postgres-usage",
      // Shared usage data lives in the dedicated TimescaleDB CNPG cluster
      // `postgres-usage-shared`, NOT the OLTP `postgres-shared` cluster
      // that the base manager defaults to. Without this override the
      // single-database read path lands on the wrong host (then fails
      // auth before reaching the missing-DB check) and every shared
      // tenant 500s on `getUsage` / `getUsageTotals`.
      sharedHost:
        process.env.TENANT_POSTGRES_SHARED_USAGE_HOST ??
        `postgres-usage-shared.support-services-${env}.svc.cluster.local`,
      sharedPort:
        Number(process.env.TENANT_POSTGRES_SHARED_USAGE_PORT) || undefined,
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
