import { Global, Module, type FactoryProvider } from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
} from "nats";
import { temporalClientProvider, TEMPORAL_CLIENT } from "./temporal.provider";
import { PostgresModule } from "./postgres.provider";
import {
  createNatsConnectionProvider,
  NATS_CONNECTION,
} from "@yoizen/database";

export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

const natsProvider = createNatsConnectionProvider("workflow-service");

const jetStreamManagerProvider: FactoryProvider<Promise<JetStreamManager>> = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: (nc: NatsConnection): Promise<JetStreamManager> =>
    nc.jetstreamManager(),
};

const jetStreamPublisherProvider: FactoryProvider<JetStreamClient> = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (nc: NatsConnection, _jsm: JetStreamManager): JetStreamClient =>
    nc.jetstream(),
};

@Global()
@Module({
  imports: [PostgresModule],
  providers: [
    temporalClientProvider,
    natsProvider,
    jetStreamManagerProvider,
    jetStreamPublisherProvider,
  ],
  exports: [
    PostgresModule,
    TEMPORAL_CLIENT,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM_PUBLISHER,
  ],
})
export class ProvidersModule {}
