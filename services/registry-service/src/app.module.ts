import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { KubernetesModule } from "./providers/kubernetes.provider";
import { ProvidersModule } from "./providers/providers.module";
import { ServicesModule } from "./modules/services/services.module";
import { CanaryModule } from "./modules/canary/canary.module";
import { RoutesModule } from "./modules/routes/routes.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "registry-service" }),
    KubernetesModule,
    ProvidersModule,
    ServicesModule,
    CanaryModule,
    RoutesModule,
    HealthModule,
  ],
})
export class AppModule {}
