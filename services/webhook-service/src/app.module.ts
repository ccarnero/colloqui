import { Global, Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { WebhookModule } from "./modules/webhook/webhook.module";
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

/** Registers NATS and Redis clients as global providers for feature modules. */
@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "webhook-service" }),
    WebhookModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
    redisProvider,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
    REDIS_CLIENT,
  ],
})
export class AppModule {}
