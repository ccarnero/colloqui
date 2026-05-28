import { Global, Module } from "@nestjs/common";
import {
  NATS_CONNECTION,
  REDIS_CLIENT,
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
  createNatsConnectionProvider,
  redisProvider,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";
import { authServiceConfig } from "../config";
import { AuthTenantConnectionManagerMongo } from "./auth-tenant-connection-manager.mongo";
import { AuthTenantConnectionManagerPostgres } from "./auth-tenant-connection-manager.postgres";
import { AuthTenantConnectionManager } from "./auth-tenant-connection-manager";
import { AuthMongoModule } from "./mongo.provider";
import { AuthPostgresModule } from "./postgres.module";

const engine = authServiceConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? AuthTenantConnectionManagerPostgres
    : AuthTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

const tenantEvictionListener =
  engine === "postgres"
    ? TenantDeletionEvictionListener
    : TenantMongoDeletionEvictionListener;

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
  imports: engine === "postgres" ? [AuthPostgresModule] : [AuthMongoModule],
  providers: [
    redisProvider,
    natsProvider,
    {
      provide: AuthTenantConnectionManager,
      useClass: tenantManagerClass,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: AuthTenantConnectionManager,
    },
    {
      provide: tenantBaseManagerToken,
      useExisting: AuthTenantConnectionManager,
    },
    tenantEvictionListener,
  ],
  exports: [
    REDIS_CLIENT,
    NATS_CONNECTION,
    AuthTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
  ],
})
export class ProvidersModule {}
