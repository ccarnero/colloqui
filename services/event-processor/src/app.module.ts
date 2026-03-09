import { Global, Module } from '@nestjs/common';
import { ProcessorModule } from './modules/processor/processor.module';
import { HealthModule } from './modules/health/health.module';
import {
  NATS_CONNECTION,
  JETSTREAM_MANAGER,
  JETSTREAM_CLIENT,
  JETSTREAM_PUBLISHER,
  natsProvider,
  jetStreamManagerProvider,
  jetStreamClientProvider,
  jetStreamPublisherProvider,
} from './providers/nats.provider';
import { REDIS_CLIENT, redisProvider } from './providers/redis.provider';

@Global()
@Module({
  imports: [ProcessorModule, HealthModule],
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamClientProvider,
    jetStreamPublisherProvider,
    redisProvider,
  ],
  exports: [
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_CLIENT,
    JETSTREAM_PUBLISHER,
    REDIS_CLIENT,
  ],
})
export class AppModule {}
