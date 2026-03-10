import { Global, Module } from '@nestjs/common';
import { temporalClientProvider, TEMPORAL_CLIENT } from './temporal.provider';
import { natsProvider, NATS_CONNECTION } from './nats.provider';

@Global()
@Module({
  providers: [temporalClientProvider, natsProvider],
  exports: [TEMPORAL_CLIENT, NATS_CONNECTION],
})
export class ProvidersModule {}
