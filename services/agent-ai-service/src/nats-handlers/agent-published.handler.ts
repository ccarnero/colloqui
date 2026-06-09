import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";
import { AgentConfigSyncService } from "../modules/config-sync/agent-config-sync.service";

@Injectable()
export class AgentPublishedHandler {
  private readonly logger = new PinoLoggerService(AgentPublishedHandler.name);

  constructor(private readonly agentConfigSync: AgentConfigSyncService) {}

  async handle(
    tenantId: string,
    payload: Record<string, unknown>,
    envelope?: EventEnvelope,
    action?: string,
  ): Promise<void> {
    const agentId = payload.agentId as string | undefined;
    if (!agentId) {
      this.logger.warn(
        `Agent published event missing agentId for tenant '${tenantId}'`,
      );
      return;
    }

    this.logger.log(
      `[agent-published] tenant='${tenantId}' agent='${agentId}' action='${action ?? "unknown"}'`,
    );

    if (action === "agent_unpublished") {
      this.agentConfigSync.handleUnpublished(tenantId, payload);
    } else {
      await this.agentConfigSync.handlePublished(tenantId, payload);
    }
  }
}
