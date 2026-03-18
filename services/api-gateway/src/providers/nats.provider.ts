import { connect, type NatsConnection, type JetStreamClient } from 'nats';
import type { JetStreamManager } from 'nats';
import type { FactoryProvider } from '@nestjs/common';
import {
  STREAM_NAME,
  STREAM_SUBJECTS,
  GATEWAY_AUDIT_STREAM_NAME,
  GATEWAY_AUDIT_STREAM_SUBJECTS,
  GATEWAY_AUDIT_STREAM_MAX_BYTES,
} from '@yoizen/shared';

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

async function ensureStream(
  jsm: JetStreamManager,
  name: string,
  subjects: readonly string[],
  maxBytes?: number,
): Promise<void> {
  try {
    await jsm.streams.info(name);
  } catch {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      ...(maxBytes ? { max_bytes: maxBytes } : {}),
    });
  }
}

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    await Promise.all([
      ensureStream(jsm, STREAM_NAME, STREAM_SUBJECTS),
      ensureStream(jsm, GATEWAY_AUDIT_STREAM_NAME, GATEWAY_AUDIT_STREAM_SUBJECTS, GATEWAY_AUDIT_STREAM_MAX_BYTES),
    ]);
    return jsm;
  },
};

export const jetStreamProvider: FactoryProvider = {
  provide: JETSTREAM,
  inject: [NATS_CONNECTION],
  useFactory: (nc: NatsConnection): JetStreamClient => nc.jetstream(),
};
