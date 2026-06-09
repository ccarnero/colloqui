import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { ExecutionsModule } from "./modules/executions/executions.module";
import { HealthModule } from "./modules/health/health.module";
import { ToolsModule } from "./modules/tools/tools.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "ai-agent-gateway" }),
    ProvidersModule,
    ExecutionsModule,
    HealthModule,
    ToolsModule,
  ],
})
export class AppModule {}
