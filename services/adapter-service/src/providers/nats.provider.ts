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
 * Connects to NATS for the adapter-service's internal-sync consumer
 * (registry → mirror adapters) and any outbound diagnostics publishing.
 * Streams are **not** owned by adapter-service — the tenant-scoped
 * `INGRESS-<tenant>` streams it subscribes to are owned by api-gateway.
 */
export const natsProvider: FactoryProvider = createNatsConnectionProvider(
  "adapter-service",
);

/**
 * Minimal JetStream manager (no streams/consumers to ensure here — the
 * internal-sync module ensures its own consumers lazily when it first
 * sees a tenant-scoped INGRESS stream).
 */
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
