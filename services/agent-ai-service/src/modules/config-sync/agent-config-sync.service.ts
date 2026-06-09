import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { AgentManagerService } from "../agents/agent-manager.service";

@Injectable()
export class AgentConfigSyncService {
  private readonly logger = new PinoLoggerService(
    AgentConfigSyncService.name,
  );

  constructor(private readonly agentManager: AgentManagerService) {}

  async handlePublished(
    tenantId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const agentId = payload.agentId as string | undefined;
    if (!agentId) {
      this.logger.warn(
        `[agent-config-sync] agent_published event missing agentId for tenant '${tenantId}'`,
      );
      return;
    }

    this.logger.log(
      `[agent-config-sync] Published: loading agent '${agentId}' for tenant '${tenantId}'`,
    );

    try {
      await this.agentManager.reloadAgent(tenantId, agentId);
    } catch (error) {
      this.logger.error(
        `[agent-config-sync] Failed to reload published agent '${agentId}' for tenant '${tenantId}': ${error}`,
      );
    }
  }

  handleUnpublished(
    tenantId: string,
    payload: Record<string, unknown>,
  ): void {
    const agentId = payload.agentId as string | undefined;
    if (!agentId) {
      this.logger.warn(
        `[agent-config-sync] agent_unpublished event missing agentId for tenant '${tenantId}'`,
      );
      return;
    }

    this.logger.log(
      `[agent-config-sync] Unpublished: removing agent '${agentId}' for tenant '${tenantId}'`,
    );
    this.agentManager.removeAgent(tenantId, agentId);
  }
}
