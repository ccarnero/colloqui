import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { ChatService } from "../../chat/chat.service";
import type { ChatRequest } from "../../chat/chat.dto";

export interface AgentTaskResult {
  readonly success: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

@Injectable()
export class AgentTaskService {
  private readonly logger = new PinoLoggerService(AgentTaskService.name);

  constructor(private readonly chatService: ChatService) {}

  async execute(
    tenantId: string,
    agentId: string,
    actionConfig: Record<string, unknown>,
  ): Promise<AgentTaskResult> {
    const task = String(actionConfig.task ?? actionConfig.prompt ?? "");
    if (!task) {
      return { success: false, error: "Missing 'task' in action_config" };
    }

    try {
      const request: ChatRequest = {
        agentId,
        message: task,
        channel: "scheduled",
      };

      this.logger.log(
        `[agent-task] Executing: tenant='${tenantId}' agent='${agentId}' task_len=${task.length}`,
      );

      const response = await this.chatService.generateReply(tenantId, request);

      return {
        success: true,
        result: {
          reply: response.text,
          agentId: response.agentId,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[agent-task] Failed: tenant='${tenantId}' agent='${agentId}': ${msg}`,
      );
      return { success: false, error: msg };
    }
  }
}
