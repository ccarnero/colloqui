import type { FactoryProvider } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
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
 * NATS connection for usage-aggregator-service. Only consumes from
 * tenant-owned streams (`INGRESS-<tenant>` + `DLQ-<tenant>`), so it
 * neither owns nor mutates stream configuration.
 */
export const natsProvider: FactoryProvider = createNatsConnectionProvider(
  "usage-aggregator-service",
);

/**
 * JetStream manager with an empty bootstrap — streams are owned by
 * api-gateway / channel-service; the aggregator simply reconciles over
 * the set periodically via {@link MultiTenantConsumerManager}.
 */
export const jetStreamManagerProvider: FactoryProvider<Promise<JetStreamManager>> =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [],
    consumers: [],
  });

export const jetStreamProvider: FactoryProvider<JetStreamClient> =
  createJetStreamPublisherProvider({
    provide: JETSTREAM,
    managerToken: JETSTREAM_MANAGER,
  });
