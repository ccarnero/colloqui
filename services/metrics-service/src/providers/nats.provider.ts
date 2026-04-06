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
  METRICS_CONSUMER_NAME,
  METRICS_SUBJECT,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  MAX_DELIVER,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_CLIENT = "JETSTREAM_CLIENT";

export const natsProvider: FactoryProvider = createNatsConnectionProvider();

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [
      {
        name: STREAM_NAME,
        subjects: STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: STREAM_MAX_BYTES,
      },
    ],
    consumers: [
      {
        stream: STREAM_NAME,
        durableName: METRICS_CONSUMER_NAME,
        filterSubject: METRICS_SUBJECT,
        maxDeliver: MAX_DELIVER,
      },
    ],
  });

export const jetStreamClientProvider: FactoryProvider =
  createJetStreamDurableConsumerProvider({
    provide: JETSTREAM_CLIENT,
    managerToken: JETSTREAM_MANAGER,
    streamName: STREAM_NAME,
    durableName: METRICS_CONSUMER_NAME,
  });
