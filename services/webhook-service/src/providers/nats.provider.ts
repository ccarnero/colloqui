import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamDurableConsumerProvider,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
  NATS_CONNECTION,
} from "@yoizen/database";
import {
  RESULTS_STREAM_NAME,
  RESULTS_STREAM_SUBJECTS,
  WEBHOOK_CONSUMER_NAME,
  STREAM_MAX_AGE_NS,
  RESULTS_STREAM_MAX_BYTES,
  MAX_DELIVER,
  DLQ_STREAM_NAME,
  DLQ_STREAM_SUBJECTS,
  DLQ_STREAM_MAX_BYTES,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_CONSUMER = "JETSTREAM_CONSUMER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider();

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [
      {
        name: RESULTS_STREAM_NAME,
        subjects: RESULTS_STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: RESULTS_STREAM_MAX_BYTES,
        retention: RetentionPolicy.Limits,
      },
      {
        name: DLQ_STREAM_NAME,
        subjects: DLQ_STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: DLQ_STREAM_MAX_BYTES,
        retention: RetentionPolicy.Limits,
      },
    ],
    consumers: [
      {
        stream: RESULTS_STREAM_NAME,
        durableName: WEBHOOK_CONSUMER_NAME,
        filterSubjects: RESULTS_STREAM_SUBJECTS,
        maxDeliver: MAX_DELIVER,
      },
    ],
  });

export const jetStreamConsumerProvider: FactoryProvider =
  createJetStreamDurableConsumerProvider({
    provide: JETSTREAM_CONSUMER,
    managerToken: JETSTREAM_MANAGER,
    streamName: RESULTS_STREAM_NAME,
    durableName: WEBHOOK_CONSUMER_NAME,
  });

export const jetStreamPublisherProvider: FactoryProvider =
  createJetStreamPublisherProvider({
    provide: JETSTREAM_PUBLISHER,
    managerToken: JETSTREAM_MANAGER,
  });
