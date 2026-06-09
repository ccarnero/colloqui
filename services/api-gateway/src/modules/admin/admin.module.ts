import { Module } from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import { AgentMemoryProxyService } from "./agent-memory-proxy.service";
import { AdminAgentsController } from "./admin-agents.controller";
import { AdminMemoriesController } from "./admin-memories.controller";
import { AdminJobsController } from "./admin-jobs.controller";
import { AdminConfigController } from "./admin-config.controller";
import { AdminToolsController } from "./admin-tools.controller";
import { AdminSkillsController } from "./admin-skills.controller";
import { AdminMcpServersController } from "./admin-mcp-servers.controller";
import { AdminSystemVariablesController } from "./admin-system-variables.controller";
import {
  AdminKnowledgeBasesController,
  AdminKnowledgeBaseDocumentsController,
} from "./admin-knowledge-bases.controller";
import { AdminStructuredKBController } from "./admin-structured-kb.controller";
import { RuntimeProxyService } from "../runtime/runtime-proxy.service";

@Module({
  controllers: [
    AdminAgentsController,
    AdminMemoriesController,
    AdminJobsController,
    AdminConfigController,
    AdminToolsController,
    AdminSkillsController,
    AdminMcpServersController,
    AdminSystemVariablesController,
    AdminKnowledgeBasesController,
    AdminKnowledgeBaseDocumentsController,
    AdminStructuredKBController,
  ],
  providers: [AdminProxyService, AgentMemoryProxyService, RuntimeProxyService],
})
export class AdminModule {}
