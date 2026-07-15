import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { ApplyModule } from "./modules/apply/apply.module";
import { HealthModule } from "./modules/health/health.module";
import { KbModule } from "./modules/kb/kb.module";
import { ManifestsModule } from "./modules/manifests/manifests.module";
import { PlanModule } from "./modules/plan/plan.module";
import { SecretsModule } from "./modules/secrets/secrets.module";
import { NatsModule } from "./providers/nats.module";
import { ProvidersModule } from "./providers/providers.module";

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "provisioning-service" }),
    ProvidersModule,
    NatsModule,
    HealthModule,
    ManifestsModule,
    SecretsModule,
    KbModule,
    PlanModule,
    ApplyModule,
  ],
})
export class AppModule {}
