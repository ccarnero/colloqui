import { Global, Module } from "@nestjs/common";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { HealthModule } from "./modules/health/health.module";
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamPublisherProvider,
} from "./providers/nats.provider";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
} from "@yoizen/database";

/** Registers shared infrastructure (NATS, tenant DB) as global providers for feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("metrics-service"),
    }),
    MetricsModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
    TenantConnectionManager,
    TenantDeletionEvictionListener,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
    TenantConnectionManager,
  ],
})
export class AppModule {}
