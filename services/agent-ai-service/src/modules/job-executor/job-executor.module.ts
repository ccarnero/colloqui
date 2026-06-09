import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { ToolsModule } from "../tools/tools.module";
import { AgentsModule } from "../agents/agents.module";
import { ChatModule } from "../chat/chat.module";
import { LlmActionService } from "./actions/llm-action.service";
import { WebhookActionService } from "./actions/webhook-action.service";
import { FunctionActionService } from "./actions/function-action.service";
import { AgentTaskService } from "./actions/agent-task.service";
import { JobExecutorService } from "./job-executor.service";

@Module({
  imports: [LlmModule, ToolsModule, AgentsModule, ChatModule],
  providers: [
    LlmActionService,
    WebhookActionService,
    FunctionActionService,
    AgentTaskService,
    JobExecutorService,
  ],
  exports: [JobExecutorService],
})
export class JobExecutorModule {}
