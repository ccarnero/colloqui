import { Module, ValidationPipe } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { TriggersModule } from "./modules/triggers/triggers.module";
import { HealthModule } from "./modules/health/health.module";
import { ExecutionsProjectorModule } from "./modules/executions-projector/executions-projector.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("workflow-service"),
    }),
    ProvidersModule,
    WorkflowsModule,
    TriggersModule,
    ExecutionsProjectorModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
