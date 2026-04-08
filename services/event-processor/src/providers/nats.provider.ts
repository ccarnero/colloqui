import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamDurableConsumerProvider,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
} from "@yoizen/database";
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  CONSUMER_NAME,
  RESULTS_STREAM_NAME,
  RESULTS_STREAM_SUBJECTS,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  RESULTS_STREAM_MAX_BYTES,
  MAX_DELIVER,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_CLIENT = "JETSTREAM_CLIENT";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider("event-processor");

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [
      {
        name: STREAM_NAME,
        subjects: STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: STREAM_MAX_BYTES,
        retention: RetentionPolicy.Limits,
      },
      {
        name: RESULTS_STREAM_NAME,
        subjects: RESULTS_STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: RESULTS_STREAM_MAX_BYTES,
        retention: RetentionPolicy.Limits,
      },
    ],
    consumers: [
      {
        stream: STREAM_NAME,
        durableName: CONSUMER_NAME,
        maxDeliver: MAX_DELIVER,
      },
    ],
  });

export const jetStreamClientProvider: FactoryProvider =
  createJetStreamDurableConsumerProvider({
    provide: JETSTREAM_CLIENT,
    managerToken: JETSTREAM_MANAGER,
    streamName: STREAM_NAME,
    durableName: CONSUMER_NAME,
  });

export const jetStreamPublisherProvider: FactoryProvider =
  createJetStreamPublisherProvider({
    provide: JETSTREAM_PUBLISHER,
    managerToken: JETSTREAM_MANAGER,
  });
