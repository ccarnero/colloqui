import { Global, Module } from "@nestjs/common";
import {
  REDIS_CLIENT,
  redisProvider,
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { agentAiServiceConfig } from "../config";
import {
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "./nats.provider";
import { AgentAiTenantConnectionManager } from "./tenant-connection.manager";
import { AgentAiTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { AgentAiTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";

const engine = agentAiServiceConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? AgentAiTenantConnectionManagerPostgres
    : AgentAiTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres"
    ? TenantConnectionManager
    : TenantMongoConnectionManager;

/**
 * DI token for the Postgres connection manager used exclusively by
 * {@link SystemVariablesProvider} (`modules/chat/system-variables.provider.ts`)
 * to query the `system_variables` table in each tenant's Postgres DB as a
 * server-side fallback when an incoming chat/execution payload lacks
 * `variables.system`. Always backed by `AgentAiTenantConnectionManagerPostgres`,
 * regardless of the agent-config storage engine — mirrors
 * `workflow-service/src/providers/providers.module.ts`.
 */
export const SYSTEM_VARIABLES_PG = Symbol("SYSTEM_VARIABLES_PG");

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
    {
      provide: SYSTEM_VARIABLES_PG,
      ...(engine === "postgres"
        ? { useExisting: AgentAiTenantConnectionManager }
        : { useClass: AgentAiTenantConnectionManagerPostgres }),
    },
  ],
  exports: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    REDIS_CLIENT,
    AgentAiTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
    SYSTEM_VARIABLES_PG,
  ],
})
export class ProvidersModule {}
