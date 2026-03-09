import { Global, Module } from '@nestjs/common';
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

@Global()
@Module({
  imports: [WebhookModule, HealthModule],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamConsumerProvider,
    jetStreamPublisherProvider,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CONSUMER,
    JETSTREAM_PUBLISHER,
  ],
})
export class AppModule {}
