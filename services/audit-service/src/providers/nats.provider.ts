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

export const natsProvider: FactoryProvider = createNatsConnectionProvider();

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (
    nc: NatsConnection,
  ): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();

    await Promise.all([
      ensureStream(jsm, {
        name: STREAM_NAME,
        subjects: STREAM_SUBJECTS,
        maxAge: STREAM_MAX_AGE_NS,
        maxBytes: STREAM_MAX_BYTES,
      }),
      ensureStream(jsm, {
        name: GATEWAY_AUDIT_STREAM_NAME,
        subjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxBytes: GATEWAY_AUDIT_STREAM_MAX_BYTES,
      }),
    ]);

    await Promise.all([
      ensureConsumer(jsm, {
        stream: STREAM_NAME,
        durableName: AUDIT_CONSUMER_NAME,
        filterSubjects: STREAM_SUBJECTS,
        maxDeliver: MAX_DELIVER,
      }),
      ensureConsumer(jsm, {
        stream: GATEWAY_AUDIT_STREAM_NAME,
        durableName: GATEWAY_AUDIT_CONSUMER_NAME,
        filterSubjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
        maxDeliver: MAX_DELIVER,
      }),
    ]);

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
    return js.consumers.get(STREAM_NAME, AUDIT_CONSUMER_NAME);
  },
};

export const gatewayAuditConsumerProvider: FactoryProvider = {
  provide: GATEWAY_AUDIT_CONSUMER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: async (
    nc: NatsConnection,
    _jm: JetStreamManager,
  ): Promise<Consumer> => {
    const js: JetStreamClient = nc.jetstream();
    return js.consumers.get(
      GATEWAY_AUDIT_STREAM_NAME,
      GATEWAY_AUDIT_CONSUMER_NAME,
    );
  },
};
