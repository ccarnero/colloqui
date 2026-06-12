import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamManagerProvider,
  createJetStreamDurableConsumerProvider,
  createJetStreamPublisherProvider,
  NATS_CONNECTION,
} from "@yoizen/database";
import { resolveServiceName } from "@yoizen/observability";
import {
  MAX_DELIVER,
  GATEWAY_AUDIT_STREAM_NAME,
  GATEWAY_AUDIT_STREAM_SUBJECTS,
  GATEWAY_AUDIT_CONSUMER_NAME,
  GATEWAY_AUDIT_STREAM_MAX_BYTES,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";
export const GATEWAY_AUDIT_CONSUMER = "GATEWAY_AUDIT_CONSUMER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider(
  resolveServiceName("audit-service"),
);

/**
 * AuditService now consumes canonical platform events straight from
 * Core NATS (`evt.*.*.platform.>` — DOCS/messaging/envelope.md §9). The legacy `EVENTS`
 * JetStream durable consumer has been dropped per REFACTOR-EVENTING
 * fase 3.4. This manager only ensures the gateway-audit stream, which
 * is a distinct pipeline (auth/HTTP-level audit).
 */
export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [
      {
        name: GATEWAY_AUDIT_STREAM_NAME,
        subjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxBytes: GATEWAY_AUDIT_STREAM_MAX_BYTES,
      },
    ],
    consumers: [
      {
        stream: GATEWAY_AUDIT_STREAM_NAME,
        durableName: GATEWAY_AUDIT_CONSUMER_NAME,
        filterSubjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxDeliver: MAX_DELIVER,
      },
    ],
  });

export const gatewayAuditConsumerProvider: FactoryProvider =
  createJetStreamDurableConsumerProvider({
    provide: GATEWAY_AUDIT_CONSUMER,
    managerToken: JETSTREAM_MANAGER,
    streamName: GATEWAY_AUDIT_STREAM_NAME,
    durableName: GATEWAY_AUDIT_CONSUMER_NAME,
  });

/**
 * JetStream publisher used by the multi-tenant durable consumer
 * managers (audit-events / channel-audit) to obtain `Consumer`
 * handles across `INGRESS-<tenant>` streams.
 */
export const jetStreamPublisherProvider: FactoryProvider =
  createJetStreamPublisherProvider({
    provide: JETSTREAM_PUBLISHER,
    managerToken: JETSTREAM_MANAGER,
  });
