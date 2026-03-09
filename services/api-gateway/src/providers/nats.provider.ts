import { connect, type NatsConnection, type JetStreamClient } from 'nats';
import type { JetStreamManager } from 'nats';
import type { FactoryProvider } from '@nestjs/common';
import { STREAM_NAME, STREAM_SUBJECTS } from '@yoizen/shared';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const JETSTREAM_MANAGER = 'JETSTREAM_MANAGER';
export const JETSTREAM = 'JETSTREAM';

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
      });
    }
    return jsm;
  },
};

export const jetStreamProvider: FactoryProvider = {
  provide: JETSTREAM,
  inject: [NATS_CONNECTION],
  useFactory: (nc: NatsConnection): JetStreamClient => nc.jetstream(),
};
