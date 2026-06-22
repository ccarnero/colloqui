import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";

/**
 * Read-only connection manager pointing at the shared TimescaleDB
 * usage cluster (`yoizen_usage`). Used by the adapter usage repository
 * to query `connector_call_events` without touching the adapter OLTP DB.
 *
 * Schema initializer is intentionally empty — this service is a consumer
 * only; DDL is owned by `usage-aggregator-service`.
 *
 * Env vars (same names as channel-service / usage-aggregator-service):
 *   TENANT_POSTGRES_SHARED_USAGE_HOST
 *   TENANT_POSTGRES_SHARED_USAGE_PORT
 *   TENANT_POSTGRES_SHARED_USAGE_DB
 *   TENANT_POSTGRES_SHARED_USAGE_USER  (falls back to TENANT_POSTGRES_SHARED_USER)
 *   TENANT_POSTGRES_SHARED_USAGE_PASSWORD (falls back to TENANT_POSTGRES_SHARED_PASSWORD)
 */
@Injectable()
export class UsageTenantConnectionManager extends TenantConnectionManager {
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
    // Read-only consumer — no schema initializer needed.
    this.setSchemaInitializer(async (_tenantId, _sql) => {
      // intentionally empty
    });
  }
}
