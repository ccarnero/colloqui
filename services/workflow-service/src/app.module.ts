import { Module, ValidationPipe } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
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
