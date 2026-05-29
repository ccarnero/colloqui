import { Injectable } from "@nestjs/common";
import {
  applyMongoSchema,
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import {
  CHANNEL_USAGE_MONGO_SCHEMA,
  SHARED_CHANNEL_USAGE_MONGO_SCHEMA,
} from "@yoizen/shared";

export type { Db } from "mongodb";

/**
 * Read-path connection manager for the **usage** MongoDB tier.
 * Dedicated tenants → `mongo-usage` in the per-tenant namespace.
 * Shared tenants → `mongo-usage-shared` in single-database mode.
 */
@Injectable()
export class UsageTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    this.configure({
      serviceName: "mongo-usage",
      sharedHost:
        process.env.TENANT_MONGO_SHARED_USAGE_HOST ??
        process.env.TENANT_POSTGRES_SHARED_USAGE_HOST ??
        `mongo-usage-shared.support-services-${env}.svc.cluster.local`,
      sharedPort:
        Number(
          process.env.TENANT_MONGO_SHARED_USAGE_PORT ??
            process.env.TENANT_POSTGRES_SHARED_USAGE_PORT,
        ) || undefined,
      sharedDatabaseMode: SharedTenantDatabaseMode.SingleDatabase,
      sharedDatabase:
        process.env.TENANT_MONGO_SHARED_USAGE_DB ??
        process.env.TENANT_POSTGRES_SHARED_USAGE_DB ??
        "yoizen_usage",
      sharedUsername:
        process.env.TENANT_MONGO_SHARED_USAGE_USER ??
        process.env.TENANT_POSTGRES_SHARED_USAGE_USER ??
        process.env.TENANT_MONGO_SHARED_USER ??
        process.env.TENANT_POSTGRES_SHARED_USER,
      sharedPassword:
        process.env.TENANT_MONGO_SHARED_USAGE_PASSWORD ??
        process.env.TENANT_POSTGRES_SHARED_USAGE_PASSWORD ??
        process.env.TENANT_MONGO_SHARED_PASSWORD ??
        process.env.TENANT_POSTGRES_SHARED_PASSWORD,
    });
    this.setSchemaInitializer(async (tenantId, db) => {
      const target = await this.resolveDatabaseTarget(tenantId);
      const schema =
        target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
          ? SHARED_CHANNEL_USAGE_MONGO_SCHEMA
          : CHANNEL_USAGE_MONGO_SCHEMA;
      await applyMongoSchema(db, schema);
    });
  }
}
