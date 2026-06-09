import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ConfigSyncService } from "./config-sync.service";
import { AgentConfigSyncService } from "./agent-config-sync.service";

@Module({
  imports: [AgentsModule],
  providers: [ConfigSyncService, AgentConfigSyncService],
  exports: [ConfigSyncService, AgentConfigSyncService],
})
export class ConfigSyncModule {}
