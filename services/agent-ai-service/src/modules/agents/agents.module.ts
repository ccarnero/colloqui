import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { AgentAiTenantConnectionManager } from "../../providers/tenant-connection.manager";
import { AgentCacheService } from "./agent-cache.service";
import { AgentConfigMongoRepository } from "./agent-config.mongo.repository";
import { AgentConfigPostgresRepository } from "./agent-config.postgres.repository";
import {
  AGENT_CONFIG_REPOSITORY,
  type IAgentConfigRepository,
} from "./agent-config.repository.interface";
import { AgentFactory } from "./agent.factory";
import { AgentManagerService } from "./agent-manager.service";
import { agentAiServiceConfig } from "../../config";

@Module({
  providers: [
    createRepositoryProvider<IAgentConfigRepository>({
      token: AGENT_CONFIG_REPOSITORY,
      engine: agentAiServiceConfig.dbEngine,
      postgresClass: AgentConfigPostgresRepository,
      mongoClass: AgentConfigMongoRepository,
    }),
    AgentCacheService,
    AgentFactory,
    AgentManagerService,
  ],
  exports: [AgentManagerService, AgentCacheService, AGENT_CONFIG_REPOSITORY],
})
export class AgentsModule {}
