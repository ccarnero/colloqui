import { PostgresModule as BasePostgresModule } from "@yoizen/database";
import { channelServiceConfig } from "../config";

export { POSTGRES_SQL } from "@yoizen/database";

/**
 * Platform Postgres pool only (health, `tenants` catalog for auto-reply cache).
 * Channel data lives in per-tenant DBs via {@link ChannelTenantConnectionManager}.
 */
export const PostgresModule = BasePostgresModule.register({
  defaultHost: channelServiceConfig.defaultPostgresHost,
});
