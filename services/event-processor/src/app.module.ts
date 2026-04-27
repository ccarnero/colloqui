import { Global, Module } from "@nestjs/common";
import { ObservabilityModule, resolveServiceName } from "@yoizen/observability";
import { ProcessorModule } from "./modules/processor/processor.module";
import { HealthModule } from "./modules/health/health.module";
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamPublisherProvider,
} from "./providers/nats.provider";
import { REDIS_CLIENT, redisProvider } from "@yoizen/database";
import {
  ADAPTER_CLIENT,
  adapterClientProvider,
} from "./providers/adapter-client.provider";

/** Registers NATS, Redis, and adapter client as global providers for the pipeline. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: resolveServiceName("event-processor"),
    }),
    ProcessorModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
    redisProvider,
    adapterClientProvider,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
    REDIS_CLIENT,
    ADAPTER_CLIENT,
  ],
})
export class AppModule {}
