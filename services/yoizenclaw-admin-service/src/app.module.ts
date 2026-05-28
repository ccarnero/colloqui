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

/** Root module: global providers and feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "yoizenclaw-admin-service" }),
    ProvidersModule,
    AgentsModule,
    JobsModule,
    ConfigFilesModule,
    RuntimeModule,
    HealthModule,
    TemplatesModule,
    AdaptersModule,
    MemoriesModule,
  ],
})
export class AppModule {}
