import { Module } from "@nestjs/common";
import { AgentToolsController } from "../memory/controllers/agent-tools.controller";
import { MemoryModule } from "../memory/memory.module";

@Module({
  imports: [MemoryModule],
  controllers: [AgentToolsController],
})
export class AgentToolsModule {}
