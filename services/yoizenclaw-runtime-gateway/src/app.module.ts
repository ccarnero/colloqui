import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { ExecutionsModule } from "./modules/executions/executions.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "yoizenclaw-runtime-gateway" }),
    ProvidersModule,
    ExecutionsModule,
    HealthModule,
  ],
})
export class AppModule {}
