import { Global, Module } from "@nestjs/common";
import {
  REDIS_CLIENT,
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  TenantMongoConnectionManager,
  redisProvider,
} from "@yoizen/database";
import {
  natsProvider,
  jetStreamManagerProvider,
  jetStreamProvider,
} from "./nats.provider";
import { AgentAiTenantConnectionManager } from "./tenant-connection.manager";
import { AgentAiTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";
import { AgentAiTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { agentAiServiceConfig } from "../config";

const engine = agentAiServiceConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? AgentAiTenantConnectionManagerPostgres
    : AgentAiTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

@Global()
@Module({
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    redisProvider,
    {
      provide: AgentAiTenantConnectionManager,
      useClass: tenantManagerClass,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: AgentAiTenantConnectionManager,
    },
    {
      provide: tenantBaseManagerToken,
      useExisting: AgentAiTenantConnectionManager,
    },
  ],
  exports: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    REDIS_CLIENT,
    AgentAiTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
  ],
})
export class ProvidersModule {}
