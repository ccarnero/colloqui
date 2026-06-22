import { Global, Module } from "@nestjs/common";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
} from "@yoizen/database";
import { connectorAdminConfig } from "../config";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  jetStreamManagerProvider,
  jetStreamProvider,
  NATS_CONNECTION,
  natsProvider,
} from "./nats.provider";
import { AdapterTenantConnectionManager } from "./tenant-connection-manager";
import { AdapterTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { AdapterTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";
import { UsageTenantConnectionManager } from "./tenant-connection-manager.usage";

const engine = connectorAdminConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? AdapterTenantConnectionManagerPostgres
    : AdapterTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres"
    ? TenantConnectionManager
    : TenantMongoConnectionManager;

const tenantEvictionListener =
  engine === "postgres"
    ? TenantDeletionEvictionListener
    : TenantMongoDeletionEvictionListener;

@Global()
@Module({
  providers: [
    {
      provide: AdapterTenantConnectionManager,
      useClass: tenantManagerClass,
    },
    {
      provide: tenantBaseManagerToken,
      useExisting: AdapterTenantConnectionManager,
    },
    UsageTenantConnectionManager,
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    tenantEvictionListener,
  ],
  exports: [
    AdapterTenantConnectionManager,
    UsageTenantConnectionManager,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM,
  ],
})
export class ProvidersModule {}
