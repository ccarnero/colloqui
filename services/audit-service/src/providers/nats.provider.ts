import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamManagerProvider,
  createJetStreamDurableConsumerProvider,
  NATS_CONNECTION,
} from "@yoizen/database";
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  AUDIT_CONSUMER_NAME,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  MAX_DELIVER,
  GATEWAY_AUDIT_STREAM_NAME,
  GATEWAY_AUDIT_STREAM_SUBJECTS,
  GATEWAY_AUDIT_CONSUMER_NAME,
  GATEWAY_AUDIT_STREAM_MAX_BYTES,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_CLIENT = "JETSTREAM_CLIENT";
export const GATEWAY_AUDIT_CONSUMER = "GATEWAY_AUDIT_CONSUMER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider("audit-service");

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [
      {
        name: STREAM_NAME,
        subjects: STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: STREAM_MAX_BYTES,
      },
      {
        name: GATEWAY_AUDIT_STREAM_NAME,
        subjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxBytes: GATEWAY_AUDIT_STREAM_MAX_BYTES,
      },
    ],
    consumers: [
      {
        stream: STREAM_NAME,
        durableName: AUDIT_CONSUMER_NAME,
        filterSubjects: STREAM_SUBJECTS,
        maxDeliver: MAX_DELIVER,
      },
      {
        stream: GATEWAY_AUDIT_STREAM_NAME,
        durableName: GATEWAY_AUDIT_CONSUMER_NAME,
        filterSubjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxDeliver: MAX_DELIVER,
      },
    ],
  });

export const jetStreamClientProvider: FactoryProvider =
  createJetStreamDurableConsumerProvider({
    provide: JETSTREAM_CLIENT,
    managerToken: JETSTREAM_MANAGER,
    streamName: STREAM_NAME,
    durableName: AUDIT_CONSUMER_NAME,
  });

export const gatewayAuditConsumerProvider: FactoryProvider =
  createJetStreamDurableConsumerProvider({
    provide: GATEWAY_AUDIT_CONSUMER,
    managerToken: JETSTREAM_MANAGER,
    streamName: GATEWAY_AUDIT_STREAM_NAME,
    durableName: GATEWAY_AUDIT_CONSUMER_NAME,
  });
