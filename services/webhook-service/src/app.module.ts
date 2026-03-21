import { Global, Module } from '@nestjs/common';
import { ObservabilityModule } from '@yoizen/observability';
import { WebhookModule } from './modules/webhook/webhook.module';
import { HealthModule } from './modules/health/health.module';
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_CONSUMER,
  JETSTREAM_PUBLISHER,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamConsumerProvider,
  jetStreamPublisherProvider,
} from './providers/nats.provider';
import { REDIS_CLIENT, redisProvider } from './providers/redis.provider';

@Global()
@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: 'webhook-service' }),
    WebhookModule,
    HealthModule,
  ],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamConsumerProvider,
    jetStreamPublisherProvider,
    redisProvider,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CONSUMER,
    JETSTREAM_PUBLISHER,
    REDIS_CLIENT,
  ],
})
export class AppModule {}
