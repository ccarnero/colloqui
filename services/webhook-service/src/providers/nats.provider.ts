import type {
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  Consumer,
} from "nats";
import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  ensureStream,
  ensureConsumer,
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

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (
    nc: NatsConnection,
  ): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();

    await ensureStream(jsm, {
      name: RESULTS_STREAM_NAME,
      subjects: RESULTS_STREAM_SUBJECTS,
      maxAge: STREAM_MAX_AGE_NS,
      maxBytes: RESULTS_STREAM_MAX_BYTES,
      retention: RetentionPolicy.Limits,
    });

    await ensureStream(jsm, {
      name: DLQ_STREAM_NAME,
      subjects: DLQ_STREAM_SUBJECTS,
      maxAge: STREAM_MAX_AGE_NS,
      maxBytes: DLQ_STREAM_MAX_BYTES,
      retention: RetentionPolicy.Limits,
    });

    await ensureConsumer(jsm, {
      stream: RESULTS_STREAM_NAME,
      durableName: WEBHOOK_CONSUMER_NAME,
      filterSubjects: RESULTS_STREAM_SUBJECTS,
      maxDeliver: MAX_DELIVER,
    });

    return jsm;
  },
};

export const jetStreamConsumerProvider: FactoryProvider = {
  provide: JETSTREAM_CONSUMER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: async (
    nc: NatsConnection,
    _jm: JetStreamManager,
  ): Promise<Consumer> => {
    const js: JetStreamClient = nc.jetstream();
    return js.consumers.get(
      RESULTS_STREAM_NAME,
      WEBHOOK_CONSUMER_NAME,
    );
  },
};

export const jetStreamPublisherProvider: FactoryProvider = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (
    nc: NatsConnection,
    _jm: JetStreamManager,
  ): JetStreamClient => nc.jetstream(),
};
