import { Global, Module } from "@nestjs/common";
import {
  NATS_CONNECTION,
  REDIS_CLIENT,
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  createNatsConnectionProvider,
  redisProvider,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";
import { POSTGRES_SQL, postgresProvider } from "./postgres.provider";
import { AuthTenantConnectionManager } from "./auth-tenant-connection-manager";

/**
 * NATS connection used solely for `platform.tenant.deleted` fan-out
 * (per-tenant pool eviction). auth-service is otherwise NATS-free, so
 * we keep the surface area minimal: a single eager Core NATS connection
 * + the eviction listener. JetStream is intentionally NOT wired here —
 * eviction is best-effort and the secondary self-heal in
 * `TenantConnectionManager.verifyConnectivity` covers any miss.
 */
const natsProvider = createNatsConnectionProvider(
  resolveServiceName("auth-service"),
);

@Global()
@Module({
  providers: [
    postgresProvider,
    redisProvider,
    natsProvider,
    AuthTenantConnectionManager,
    // The shared listener depends on the base `TenantConnectionManager`
    // token from `@yoizen/database`; aliasing keeps the subclass identity
    // for the rest of auth-service while routing the eviction call into
    // the same pool cache.
    {
      provide: TenantConnectionManager,
      useExisting: AuthTenantConnectionManager,
    },
    TenantDeletionEvictionListener,
  ],
  exports: [
    POSTGRES_SQL,
    REDIS_CLIENT,
    NATS_CONNECTION,
    AuthTenantConnectionManager,
  ],
})
export class ProvidersModule {}
