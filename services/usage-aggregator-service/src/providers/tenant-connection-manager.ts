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
 * Tenant-aware connection manager for the **usage** TimescaleDB tier.
 * Routes per `tenants.tier`:
 *
 * - **Dedicated** → `postgres-usage` Service in the per-tenant namespace
 *   (provisioned by `TenantUsagePostgresProvisioner`).
 * - **Shared**    → the platform-wide `postgres-usage-shared` CNPG
 *   cluster in single-database mode (`yoizen_usage`).
 *
 * The base manager defaults `sharedHost` to OLTP `postgres-shared` —
 * wrong cluster for usage data — so we override it here to land on
 * `postgres-usage-shared`.
 *
 * Lazy-initialises the `channel_events` hypertable + continuous
 * aggregates the first time a tenant's pool is touched (schema DDL is
 * idempotent so repeated invocations are cheap). All pool caching,
 * `ensureSchema` deduplication and teardown are inherited from
 * `@yoizen/database` `TenantConnectionManager`.
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
      // the base manager defaults to. Without this override the shared
      // write path opens a pool against the wrong host and every flush
      // fails auth before reaching the missing-DB check.
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
