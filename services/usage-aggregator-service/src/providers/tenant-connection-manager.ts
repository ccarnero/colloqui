import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";
import { CHANNEL_USAGE_SCHEMA_SQL } from "@yoizen/shared";

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
    this.configure({ serviceName: "postgres-usage" });
    this.setSchema([CHANNEL_USAGE_SCHEMA_SQL]);
  }
}
