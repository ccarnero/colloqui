import { connect, type NatsConnection } from 'nats';
import type { FactoryProvider } from '@nestjs/common';

export const NATS_CONNECTION = 'NATS_CONNECTION';

export const natsProvider: FactoryProvider = {
  provide: NATS_CONNECTION,
  useFactory: async (): Promise<NatsConnection> => {
    const url = process.env.NATS_URL ?? 'nats://localhost:4222';
    return connect({ servers: url });
  },
};
