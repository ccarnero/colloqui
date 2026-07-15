// NATS/JetStream DI wiring for provisioning-service's apply-audit publisher
// (TAXONOMY.md rule 22). Mirrors registry-service's `nats.provider.ts`
// (`services/registry-service/src/providers/nats.provider.ts`) — a pure
// producer here, ensures no streams up front (per-tenant `INGRESS-<tenant>`
// streams are ensured lazily, on first publish, by `ApplyEventsPublisher`
// via `ensureTenantIngressStream`, same as registry-service's publisher).

import type { FactoryProvider } from "@nestjs/common";
import {
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
  createNatsConnectionProvider,
} from "@yoizen/database";
import type { JetStreamClient, JetStreamManager, NatsConnection } from "nats";

export { NATS_CONNECTION } from "@yoizen/database";

export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM = "JETSTREAM";

export const natsProvider: FactoryProvider<Promise<NatsConnection>> =
  createNatsConnectionProvider("provisioning-service");

export const jetStreamManagerProvider: FactoryProvider<
  Promise<JetStreamManager>
> = createJetStreamManagerProvider(JETSTREAM_MANAGER, {
  streams: [],
  consumers: [],
});

export const jetStreamProvider: FactoryProvider<JetStreamClient> =
  createJetStreamPublisherProvider({
    provide: JETSTREAM,
    managerToken: JETSTREAM_MANAGER,
  });
