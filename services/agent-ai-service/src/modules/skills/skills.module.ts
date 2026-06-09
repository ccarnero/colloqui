import { Module } from "@nestjs/common";
import { ToolsModule } from "../tools/tools.module";
import { LlmModule } from "../llm/llm.module";
import { SkillRouterService } from "./skill-router.service";
import { SkillExecutorService } from "./skill-executor.service";

@Module({
  imports: [ToolsModule, LlmModule],
  providers: [SkillRouterService, SkillExecutorService],
  exports: [SkillRouterService, SkillExecutorService],
})
export class SkillsModule {}
