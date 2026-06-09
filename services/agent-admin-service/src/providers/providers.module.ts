import { Global, Module } from "@nestjs/common";
import {
  REDIS_CLIENT,
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  TenantMongoConnectionManager,
  redisProvider,
} from "@yoizen/database";
import { agentAdminServiceConfig } from "../config";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  LAZY_NATS,
  NatsPublisher,
  jetStreamClientProvider,
  jetStreamManagerProvider,
  lazyNatsProvider,
} from "./nats.provider";
import { TenantDeletionEvictionListener as LazyTenantDeletionEvictionListener } from "./tenant-deletion-eviction-listener";
import { YoizenclawTenantConnectionManager } from "./tenant-connection-manager";
import { YoizenclawTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { YoizenclawTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";

const engine = agentAdminServiceConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? YoizenclawTenantConnectionManagerPostgres
    : YoizenclawTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

const tenantEvictionListener =
  engine === "postgres"
    ? LazyTenantDeletionEvictionListener
    : LazyTenantDeletionEvictionListener;

@Global()
@Module({
  providers: [
    lazyNatsProvider,
    jetStreamManagerProvider,
    jetStreamClientProvider,
    redisProvider,
    NatsPublisher,
    {
      provide: YoizenclawTenantConnectionManager,
      useClass: tenantManagerClass,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: YoizenclawTenantConnectionManager,
    },
    {
      provide: tenantBaseManagerToken,
      useExisting: YoizenclawTenantConnectionManager,
    },
    tenantEvictionListener,
  ],
  exports: [
    LAZY_NATS,
    JETSTREAM_MANAGER,
    JETSTREAM,
    REDIS_CLIENT,
    YoizenclawTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
    NatsPublisher,
  ],
})
export class ProvidersModule {}
