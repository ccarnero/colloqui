import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { LlmModule } from "../llm/llm.module";
import { MemoryModule } from "../memory/memory.module";
import { SkillsModule } from "../skills/skills.module";
import { TemplateRendererModule } from "../template-renderer/template-renderer.module";
import { ToolsModule } from "../tools/tools.module";
import { ChatService } from "./chat.service";
import { ContextBuilderService } from "./context-builder.service";
import { SessionChatService } from "./session-chat.service";

@Module({
  imports: [AgentsModule, LlmModule, MemoryModule, SkillsModule, TemplateRendererModule, ToolsModule],
  providers: [
    ChatService,
    ContextBuilderService,
    SessionChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
