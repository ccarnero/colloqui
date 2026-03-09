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
  STREAM_NAME,
  STREAM_SUBJECTS,
  CONSUMER_NAME,
  RESULTS_STREAM_NAME,
  RESULTS_STREAM_SUBJECTS,
  STREAM_MAX_AGE_NS,
  STREAM_MAX_BYTES,
  RESULTS_STREAM_MAX_BYTES,
  MAX_DELIVER,
} from '@yoizen/shared';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const JETSTREAM_MANAGER = 'JETSTREAM_MANAGER';
export const JETSTREAM_CLIENT = 'JETSTREAM_CLIENT';
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
      const info = await jsm.streams.info(STREAM_NAME);
      const cfg = info.config;
      if (cfg.max_age !== STREAM_MAX_AGE_NS || cfg.max_bytes !== STREAM_MAX_BYTES) {
        await jsm.streams.update(STREAM_NAME, {
          ...cfg,
          max_age: STREAM_MAX_AGE_NS,
          max_bytes: STREAM_MAX_BYTES,
        });
      }
    } catch {
      await jsm.streams.add({
        name: STREAM_NAME,
        subjects: [...STREAM_SUBJECTS],
        retention: RetentionPolicy.Limits,
        max_age: STREAM_MAX_AGE_NS,
        max_bytes: STREAM_MAX_BYTES,
      });
    }

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
      await jsm.consumers.add(STREAM_NAME, {
        durable_name: CONSUMER_NAME,
        deliver_policy: DeliverPolicy.All,
        ack_policy: AckPolicy.Explicit,
        replay_policy: ReplayPolicy.Instant,
        max_deliver: MAX_DELIVER,
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
    return js.consumers.get(STREAM_NAME, CONSUMER_NAME);
  },
};

export const jetStreamPublisherProvider: FactoryProvider = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (nc: NatsConnection, _jm: JetStreamManager): JetStreamClient =>
    nc.jetstream(),
};
