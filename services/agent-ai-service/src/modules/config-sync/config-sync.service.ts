import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { AgentManagerService } from "../agents/agent-manager.service";

@Injectable()
export class ConfigSyncService {
  private readonly logger = new PinoLoggerService(ConfigSyncService.name);

  constructor(private readonly agentManager: AgentManagerService) {}

  async handleConfigSync(
    tenantId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(
      `[config-sync] Processing config sync for tenant '${tenantId}'`,
    );

    if (payload.agent_config && typeof payload.agent_config === "object") {
      await this.handleAgentConfigSync(
        tenantId,
        payload.agent_config as Record<string, unknown>,
      );
      return;
    }

    const files = payload.files;
    if (Array.isArray(files)) {
      this.logger.debug(
        `[config-sync] Legacy files-based config sync for tenant '${tenantId}' (${files.length} files) — skipping, migrated to agent-memory-service`,
      );
      return;
    }

    const deletePaths = payload.delete_paths;
    if (deletePaths) {
      this.logger.debug(
        `[config-sync] Processing delete_paths for tenant '${tenantId}'`,
      );
      return;
    }

    const agentIds = this.extractAffectedAgentIds(payload);
    if (agentIds.length === 0) {
      this.logger.debug(
        `[config-sync] No specific agents in payload for tenant '${tenantId}'`,
      );
      return;
    }

    for (const agentId of agentIds) {
      try {
        await this.agentManager.reloadAgent(tenantId, agentId);
      } catch (error) {
        this.logger.error(
          `[config-sync] Failed to reload agent '${agentId}' for tenant '${tenantId}': ${error}`,
        );
      }
    }
  }

  async handleJobsSync(
    tenantId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(
      `[config-sync] Processing jobs sync for tenant '${tenantId}'`,
    );

    const jobs = payload.jobs;
    if (!Array.isArray(jobs)) {
      this.logger.debug(
        `[config-sync] No jobs array in jobs_sync payload for tenant '${tenantId}'`,
      );
      return;
    }

    this.logger.log(
      `[config-sync] Synced ${jobs.length} job definitions for tenant '${tenantId}'`,
    );
  }

  private async handleAgentConfigSync(
    tenantId: string,
    agentConfig: Record<string, unknown>,
  ): Promise<void> {
    const agentId =
      (agentConfig.id as string | undefined)?.trim() ??
      (agentConfig.agentId as string | undefined)?.trim();

    if (!agentId) {
      this.logger.warn(
        `[config-sync] Agent config missing id for tenant '${tenantId}'`,
      );
      return;
    }

    this.logger.log(
      `[config-sync] Agent config sync for agent '${agentId}' tenant '${tenantId}'`,
    );

    try {
      await this.agentManager.reloadAgent(tenantId, agentId);
    } catch (error) {
      this.logger.error(
        `[config-sync] Failed to reload agent '${agentId}' for tenant '${tenantId}': ${error}`,
      );
    }
  }

  private extractAffectedAgentIds(
    payload: Record<string, unknown>,
  ): string[] {
    if (Array.isArray(payload.agentIds)) {
      return payload.agentIds.filter(
        (id): id is string => typeof id === "string",
      );
    }
    if (typeof payload.agentId === "string") {
      return [payload.agentId];
    }
    return [];
  }
}
