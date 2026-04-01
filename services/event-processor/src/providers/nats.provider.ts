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

export const natsProvider: FactoryProvider = createNatsConnectionProvider();

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (
    nc: NatsConnection,
  ): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();

    await ensureStream(jsm, {
      name: STREAM_NAME,
      subjects: STREAM_SUBJECTS,
      maxAge: STREAM_MAX_AGE_NS,
      maxBytes: STREAM_MAX_BYTES,
      retention: RetentionPolicy.Limits,
    });

    await ensureStream(jsm, {
      name: RESULTS_STREAM_NAME,
      subjects: RESULTS_STREAM_SUBJECTS,
      maxAge: STREAM_MAX_AGE_NS,
      maxBytes: RESULTS_STREAM_MAX_BYTES,
      retention: RetentionPolicy.Limits,
    });

    await ensureConsumer(jsm, {
      stream: STREAM_NAME,
      durableName: CONSUMER_NAME,
      maxDeliver: MAX_DELIVER,
    });

    return jsm;
  },
};

export const jetStreamClientProvider: FactoryProvider = {
  provide: JETSTREAM_CLIENT,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: async (
    nc: NatsConnection,
    _jm: JetStreamManager,
  ): Promise<Consumer> => {
    const js: JetStreamClient = nc.jetstream();
    return js.consumers.get(STREAM_NAME, CONSUMER_NAME);
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
