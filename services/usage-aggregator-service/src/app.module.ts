import { Module } from "@nestjs/common";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import { ProvidersModule } from "./providers/providers.module";
import { HealthModule } from "./modules/health/health.module";
import { AggregatorModule } from "./modules/aggregator/aggregator.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("usage-aggregator"),
    }),
    ProvidersModule,
    AggregatorModule,
    HealthModule,
  ],
})
export class AppModule {}
