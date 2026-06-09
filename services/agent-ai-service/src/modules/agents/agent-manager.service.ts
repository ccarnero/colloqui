import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { AgentCacheService } from "./agent-cache.service";
import { AgentFactory } from "./agent.factory";
import type { Agent } from "./agent.model";
import {
  AGENT_CONFIG_REPOSITORY,
  type IAgentConfigRepository,
} from "./agent-config.repository.interface";

@Injectable()
export class AgentManagerService {
  private readonly logger = new PinoLoggerService(AgentManagerService.name);

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY)
    private readonly repository: IAgentConfigRepository,
    private readonly cache: AgentCacheService,
    private readonly factory: AgentFactory,
  ) {}

  async getAgent(tenantId: string, agentId: string): Promise<Agent | null> {
    const cached = this.cache.get(tenantId, agentId);
    if (cached) {
      this.logger.debug(`Cache hit for agent '${agentId}' in tenant '${tenantId}'`);
      return cached;
    }

    this.logger.debug(`Cache miss for agent '${agentId}' in tenant '${tenantId}', loading from DB`);
    const config = await this.repository.findById(tenantId, agentId);
    if (!config) return null;

    const agent = this.factory.build(config);
    this.cache.set(tenantId, agent);
    return agent;
  }

  async reloadAgent(tenantId: string, agentId: string): Promise<Agent | null> {
    this.logger.log(`Reloading agent '${agentId}' for tenant '${tenantId}'`);
    this.cache.invalidate(tenantId, agentId);

    const config = await this.repository.findById(tenantId, agentId);
    if (!config) {
      this.logger.warn(
        `Agent '${agentId}' not found in DB for tenant '${tenantId}' during reload`,
      );
      return null;
    }

    const agent = this.factory.build(config);
    this.cache.set(tenantId, agent);
    return agent;
  }

  removeAgent(tenantId: string, agentId: string): void {
    this.logger.log(`Removing agent '${agentId}' for tenant '${tenantId}'`);
    this.cache.invalidate(tenantId, agentId);
  }
}
