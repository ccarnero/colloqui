import { Global, Module } from "@nestjs/common";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
} from "@yoizen/database";
import { usageAggregatorServiceConfig } from "../config";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";
import { UsageTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { UsageTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "./nats.provider";

const engine = usageAggregatorServiceConfig.dbEngine;
const usageManagerClass =
  engine === "postgres"
    ? UsageTenantConnectionManagerPostgres
    : UsageTenantConnectionManagerMongo;

const baseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

const evictionListener =
  engine === "postgres"
    ? TenantDeletionEvictionListener
    : TenantMongoDeletionEvictionListener;

/** Global provider module for usage-aggregator-service. */
@Global()
@Module({
  providers: [
    {
      provide: UsageTenantConnectionManager,
      useClass: usageManagerClass,
    },
    {
      provide: baseManagerToken,
      useExisting: UsageTenantConnectionManager,
    },
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    evictionListener,
  ],
  exports: [
    UsageTenantConnectionManager,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM,
  ],
})
export class ProvidersModule {}
