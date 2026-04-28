import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider(
  resolveServiceName("event-processor"),
);

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [],
    consumers: [],
  });

export const jetStreamPublisherProvider: FactoryProvider =
  createJetStreamPublisherProvider({
    provide: JETSTREAM_PUBLISHER,
    managerToken: JETSTREAM_MANAGER,
  });
