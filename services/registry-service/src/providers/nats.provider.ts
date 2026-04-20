import type { FactoryProvider } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
  createNatsConnectionProvider,
} from "@yoizen/database";

export { NATS_CONNECTION } from "@yoizen/database";

export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM = "JETSTREAM";

/**
 * Connects to NATS for registry-service event emission (wdocs 02 §9).
 * registry-service is a pure producer here — the tenant INGRESS streams
 * are owned by api-gateway, so this provider ensures no streams.
 */
export const natsProvider: FactoryProvider = createNatsConnectionProvider(
  "registry-service",
);

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [],
    consumers: [],
  });

export const jetStreamProvider: FactoryProvider<JetStreamClient> =
  createJetStreamPublisherProvider({
    provide: JETSTREAM,
    managerToken: JETSTREAM_MANAGER,
  });
