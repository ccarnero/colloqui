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
  GATEWAY_AUDIT_STREAM_NAME,
  GATEWAY_AUDIT_STREAM_SUBJECTS,
  GATEWAY_AUDIT_CONSUMER_NAME,
  GATEWAY_AUDIT_STREAM_MAX_BYTES,
} from '@yoizen/shared';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const JETSTREAM_MANAGER = 'JETSTREAM_MANAGER';
export const JETSTREAM_CLIENT = 'JETSTREAM_CLIENT';
export const GATEWAY_AUDIT_CONSUMER = 'GATEWAY_AUDIT_CONSUMER';

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
  opts?: { max_age?: number; max_bytes?: number },
): Promise<void> {
  try {
    await jsm.streams.info(name);
  } catch {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      ...opts,
    });
  }
}

async function ensureConsumer(
  jsm: JetStreamManager,
  stream: string,
  durableName: string,
  filterSubjects: readonly string[],
): Promise<void> {
  try {
    await jsm.consumers.add(stream, {
      durable_name: durableName,
      deliver_policy: DeliverPolicy.All,
      ack_policy: AckPolicy.Explicit,
      replay_policy: ReplayPolicy.Instant,
      max_deliver: MAX_DELIVER,
      filter_subjects: [...filterSubjects],
    });
  } catch {
    // consumer already exists
  }
}

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    await Promise.all([
      ensureStream(jsm, STREAM_NAME, STREAM_SUBJECTS, {
        max_age: STREAM_MAX_AGE_NS,
        max_bytes: STREAM_MAX_BYTES,
      }),
      ensureStream(jsm, GATEWAY_AUDIT_STREAM_NAME, GATEWAY_AUDIT_STREAM_SUBJECTS, {
        max_bytes: GATEWAY_AUDIT_STREAM_MAX_BYTES,
      }),
    ]);
    await Promise.all([
      ensureConsumer(jsm, STREAM_NAME, AUDIT_CONSUMER_NAME, STREAM_SUBJECTS),
      ensureConsumer(jsm, GATEWAY_AUDIT_STREAM_NAME, GATEWAY_AUDIT_CONSUMER_NAME, GATEWAY_AUDIT_STREAM_SUBJECTS),
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
    return js.consumers.get(GATEWAY_AUDIT_STREAM_NAME, GATEWAY_AUDIT_CONSUMER_NAME);
  },
};
