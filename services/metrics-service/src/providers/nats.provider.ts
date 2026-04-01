import type {
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  Consumer,
} from "nats";
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
    });

    await ensureConsumer(jsm, {
      stream: STREAM_NAME,
      durableName: METRICS_CONSUMER_NAME,
      filterSubject: METRICS_SUBJECT,
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
    return js.consumers.get(STREAM_NAME, METRICS_CONSUMER_NAME);
  },
};
