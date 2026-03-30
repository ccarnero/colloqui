import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  RetentionPolicy,
} from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
} from "@yoizen/shared";

export const NATS_CONNECTION = "NATS_CONNECTION";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

const createNatsConnection = async (): Promise<NatsConnection> => {
  const url = process.env.NATS_URL ?? "nats://localhost:4222";
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
    return nc.jetstreamManager();
  },
};

/**
 * Ensures a per-tenant INGRESS stream exists.
 * Called lazily on first publish for a given tenant.
 */
export async function ensureIngressStream(
  jsm: JetStreamManager,
  streamName: string,
  subjects: string[],
): Promise<void> {
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects,
      retention: RetentionPolicy.Limits,
      max_age: CHANNEL_STREAM_MAX_AGE_NS,
      max_bytes: CHANNEL_STREAM_MAX_BYTES,
    });
  }
}

export const jetStreamPublisherProvider: FactoryProvider = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (
    nc: NatsConnection,
    _jsm: JetStreamManager,
  ): JetStreamClient => nc.jetstream(),
};
