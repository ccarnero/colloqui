import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager as BaseTenantConnectionManager,
} from "@yoizen/database";
import {
  CHANNEL_USAGE_SCHEMA_SQL,
  SHARED_CHANNEL_USAGE_SCHEMA_SQL,
} from "@yoizen/shared";


/**
 * Read-path connection manager for the **usage** TimescaleDB tier.
 */
@Injectable()
export class UsageTenantConnectionManagerPostgres extends BaseTenantConnectionManager {
  constructor() {
    super();
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    this.configure({
      serviceName: "postgres-usage",
      sharedHost:
        process.env.TENANT_POSTGRES_SHARED_USAGE_HOST ??
        `postgres-usage-shared.support-services-${env}.svc.cluster.local`,
      sharedPort:
        Number(process.env.TENANT_POSTGRES_SHARED_USAGE_PORT) || undefined,
      sharedDatabaseMode: SharedTenantDatabaseMode.SingleDatabase,
      sharedDatabase:
        process.env.TENANT_POSTGRES_SHARED_USAGE_DB ?? "yoizen_usage",
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
