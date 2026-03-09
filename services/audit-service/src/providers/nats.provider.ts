import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  type Consumer,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} from 'nats';
import type { FactoryProvider } from '@nestjs/common';
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  AUDIT_CONSUMER_NAME,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  MAX_DELIVER,
} from '@yoizen/shared';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const JETSTREAM_MANAGER = 'JETSTREAM_MANAGER';
export const JETSTREAM_CLIENT = 'JETSTREAM_CLIENT';

const createNatsConnection = async (): Promise<NatsConnection> => {
  const url = process.env.NATS_URL ?? 'nats://localhost:4222';
  return connect({ servers: url });
};

export const natsProvider: FactoryProvider = {
  provide: NATS_CONNECTION,
  useFactory: createNatsConnection,
};

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    try {
      await jsm.streams.info(STREAM_NAME);
    } catch {
      await jsm.streams.add({
        name: STREAM_NAME,
        subjects: [...STREAM_SUBJECTS],
        max_age: STREAM_MAX_AGE_NS,
        max_bytes: STREAM_MAX_BYTES,
      });
    }
    try {
      await jsm.consumers.add(STREAM_NAME, {
        durable_name: AUDIT_CONSUMER_NAME,
        deliver_policy: DeliverPolicy.All,
        ack_policy: AckPolicy.Explicit,
        replay_policy: ReplayPolicy.Instant,
        max_deliver: MAX_DELIVER,
        filter_subjects: [...STREAM_SUBJECTS],
      });
    } catch {
      // consumer exists
    }
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
