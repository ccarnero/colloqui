import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { TriggersModule } from "./modules/triggers/triggers.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "workflow-service" }),
    ProvidersModule,
    WorkflowsModule,
    TriggersModule,
    HealthModule,
  ],
})
export class AppModule {}
