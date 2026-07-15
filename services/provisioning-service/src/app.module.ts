import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ApplyModule } from "./modules/apply/apply.module";
import { HealthModule } from "./modules/health/health.module";
import { ManifestsModule } from "./modules/manifests/manifests.module";
import { PlanModule } from "./modules/plan/plan.module";
import { ProvidersModule } from "./providers/providers.module";

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "provisioning-service" }),
    ProvidersModule,
    HealthModule,
    ManifestsModule,
    PlanModule,
    ApplyModule,
  ],
})
export class AppModule {}
