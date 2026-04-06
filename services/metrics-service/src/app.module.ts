import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { HealthModule } from "./modules/health/health.module";
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_CLIENT,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamClientProvider,
} from "./providers/nats.provider";
import { TenantConnectionManager } from "@yoizen/database";

/** Registers shared infrastructure (NATS, tenant DB) as global providers for feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "metrics-service" }),
    MetricsModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamClientProvider,
    TenantConnectionManager,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CLIENT,
    TenantConnectionManager,
  ],
})
export class AppModule {}
