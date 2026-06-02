import { Global, Module } from "@nestjs/common";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
} from "@yoizen/database";
import { connectorAdminConfig } from "../config";
import { AdapterTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { AdapterTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";
import { AdapterTenantConnectionManager } from "./tenant-connection-manager";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "./nats.provider";

const engine = connectorAdminConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? AdapterTenantConnectionManagerPostgres
    : AdapterTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

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
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    tenantEvictionListener,
  ],
  exports: [
    AdapterTenantConnectionManager,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM,
  ],
})
export class ProvidersModule {}
