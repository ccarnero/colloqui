import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  type Consumer,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  RetentionPolicy,
} from 'nats';
import type { FactoryProvider } from '@nestjs/common';
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
} from '@yoizen/shared';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const JETSTREAM_MANAGER = 'JETSTREAM_MANAGER';
export const JETSTREAM_CONSUMER = 'JETSTREAM_CONSUMER';
export const JETSTREAM_PUBLISHER = 'JETSTREAM_PUBLISHER';

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
      await jsm.streams.info(RESULTS_STREAM_NAME);
    } catch {
      await jsm.streams.add({
        name: RESULTS_STREAM_NAME,
        subjects: [...RESULTS_STREAM_SUBJECTS],
        retention: RetentionPolicy.Limits,
        max_age: STREAM_MAX_AGE_NS,
        max_bytes: RESULTS_STREAM_MAX_BYTES,
      });
    }

    try {
      await jsm.streams.info(DLQ_STREAM_NAME);
    } catch {
      await jsm.streams.add({
        name: DLQ_STREAM_NAME,
        subjects: [...DLQ_STREAM_SUBJECTS],
        retention: RetentionPolicy.Limits,
        max_age: STREAM_MAX_AGE_NS,
        max_bytes: DLQ_STREAM_MAX_BYTES,
      });
    }

    try {
      await jsm.consumers.add(RESULTS_STREAM_NAME, {
        durable_name: WEBHOOK_CONSUMER_NAME,
        deliver_policy: DeliverPolicy.All,
        ack_policy: AckPolicy.Explicit,
        replay_policy: ReplayPolicy.Instant,
        max_deliver: MAX_DELIVER,
        filter_subjects: [...RESULTS_STREAM_SUBJECTS],
      });
    } catch {
      // consumer exists
    }

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
    return js.consumers.get(RESULTS_STREAM_NAME, WEBHOOK_CONSUMER_NAME);
  },
};

export const jetStreamPublisherProvider: FactoryProvider = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (nc: NatsConnection, _jm: JetStreamManager): JetStreamClient =>
    nc.jetstream(),
};
