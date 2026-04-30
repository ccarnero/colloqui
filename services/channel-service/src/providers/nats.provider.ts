import type { NatsConnection, JetStreamClient, JetStreamManager } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  NATS_CONNECTION,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider(
  resolveServiceName("channel-service"),
);

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> =>
    nc.jetstreamManager(),
};

export const jetStreamPublisherProvider: FactoryProvider = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (nc: NatsConnection, _jsm: JetStreamManager): JetStreamClient =>
    nc.jetstream(),
};
