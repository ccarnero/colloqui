import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { ConfigFilesModule } from "./modules/config-files/config-files.module";
import { RuntimeModule } from "./modules/runtime/runtime.module";
import { HealthModule } from "./modules/health/health.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { AdaptersModule } from "./modules/adapters/adapters.module";
import { MemoriesModule } from "./modules/memories/memories.module";
import { SkillsModule } from "./modules/skills/skills.module";
import { McpServersModule } from "./modules/mcp-servers/mcp-servers.module";
import { SystemVariablesModule } from "./modules/system-variables/system-variables.module";
import { KnowledgeBasesModule } from "./modules/knowledge-bases/knowledge-bases.module";
import { StructuredKBModule } from "./modules/structured-kb/structured-kb.module";

/** Root module: global providers and feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "agent-admin-service" }),
    ProvidersModule,
    AgentsModule,
    JobsModule,
    ConfigFilesModule,
    RuntimeModule,
    HealthModule,
    TemplatesModule,
    AdaptersModule,
    MemoriesModule,
    SkillsModule,
    McpServersModule,
    SystemVariablesModule,
    KnowledgeBasesModule,
    StructuredKBModule,
  ],
})
export class AppModule {}
