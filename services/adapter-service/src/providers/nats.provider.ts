import type { FactoryProvider } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
  createNatsConnectionProvider,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";

export { NATS_CONNECTION } from "@yoizen/database";

/**
 * DI tokens for the JetStream stack used by the internal-sync durable
 * consumer. Mirrors the pattern in
 * `services/workflow-service/src/providers/providers.module.ts` so the
 * adapter-service consumer wires up identically across the platform.
 */
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM = "JETSTREAM";

/**
 * Connects to NATS for the adapter-service. Used by:
 *   - the internal-sync durable consumer (`registry-service` →
 *     `http_adapters` mirror, JetStream pull),
 *   - the NATS+Postgres aggregate health probe,
 *   - any legacy code paths still consuming `NATS_CONNECTION` directly.
 *
 * Resolved service name picks up `OTEL_SERVICE_NAME` first (set by the
 * `*-api` / `*-worker` Knative/Deployment manifests), falling back to
 * `adapter-service-<mode>` so Prometheus/Tempo labels remain aligned
 * with the deployment role.
 */
export const natsProvider: FactoryProvider<Promise<NatsConnection>> =
  createNatsConnectionProvider(resolveServiceName("adapter-service"));

/**
 * Minimal JetStream manager. adapter-service does NOT own any streams
 * itself — the per-tenant `INGRESS-<tenant>` streams are provisioned
 * lazily by `api-gateway` / `channel-service` / `event-processor` and
 * the durable consumer on each is ensured by
 * `MultiTenantConsumerManager` at runtime, NOT here.
 *
 * The empty `streams: []` / `consumers: []` lists are deliberate:
 * `createJetStreamManagerProvider` only ensures resources during DI
 * factory init, while the consumer-manager handles per-tenant durable
 * lifecycle reactively (new tenants get bound on every reconcile tick
 * without a pod restart).
 */
export const jetStreamManagerProvider: FactoryProvider<
  Promise<JetStreamManager>
> = createJetStreamManagerProvider(JETSTREAM_MANAGER, {
  streams: [],
  consumers: [],
});

/**
 * JetStream client used by the multi-tenant consumer manager (pull
 * fetches / acks) and any future post-commit publish hook the
 * adapter-service might add. Resolved off the same `NATS_CONNECTION`
 * + `JETSTREAM_MANAGER` tokens so a single broker connection is shared
 * across every NATS-touching subsystem in the pod.
 */
export const jetStreamProvider: FactoryProvider<JetStreamClient> =
  createJetStreamPublisherProvider({
    provide: JETSTREAM,
    managerToken: JETSTREAM_MANAGER,
  });
