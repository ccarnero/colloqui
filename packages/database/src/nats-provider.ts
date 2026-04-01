import {
  connect,
  type NatsConnection,
  type JetStreamManager,
  type RetentionPolicy,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} from "nats";
import type { FactoryProvider } from "@nestjs/common";

export const NATS_CONNECTION = "NATS_CONNECTION";

/**
 * Creates a NestJS `FactoryProvider` that connects to NATS.
 * Reads `NATS_URL` from environment (default: `nats://localhost:4222`).
 */
export function createNatsConnectionProvider(): FactoryProvider<Promise<NatsConnection>> {
  return {
    provide: NATS_CONNECTION,
    useFactory: async (): Promise<NatsConnection> => {
      const url =
        process.env.NATS_URL ?? "nats://localhost:4222";
      return connect({ servers: url });
    },
  };
}

export interface EnsureStreamOptions {
  name: string;
  subjects: readonly string[];
  maxAge?: number;
  maxBytes?: number;
  retention?: RetentionPolicy;
}

/**
 * Ensures a JetStream stream exists. Creates it if missing,
 * optionally updates limits if the stream already exists and
 * `maxAge`/`maxBytes` differ from current config.
 */
export async function ensureStream(
  jsm: JetStreamManager,
  options: EnsureStreamOptions,
): Promise<void> {
  const { name, subjects, maxAge, maxBytes, retention } =
    options;
  try {
    const info = await jsm.streams.info(name);
    const cfg = info.config;
    const needsUpdate =
      (maxAge !== undefined && cfg.max_age !== maxAge) ||
      (maxBytes !== undefined && cfg.max_bytes !== maxBytes);

    if (needsUpdate) {
      await jsm.streams.update(name, {
        ...cfg,
        ...(maxAge !== undefined ? { max_age: maxAge } : {}),
        ...(maxBytes !== undefined
          ? { max_bytes: maxBytes }
          : {}),
      });
    }
  } catch {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      ...(maxAge !== undefined ? { max_age: maxAge } : {}),
      ...(maxBytes !== undefined
        ? { max_bytes: maxBytes }
        : {}),
      ...(retention !== undefined ? { retention } : {}),
    });
  }
}

export interface EnsureConsumerOptions {
  stream: string;
  durableName: string;
  filterSubject?: string;
  filterSubjects?: readonly string[];
  maxDeliver?: number;
}

/**
 * Ensures a durable JetStream consumer exists on the given stream.
 * No-op if the consumer already exists.
 */
export async function ensureConsumer(
  jsm: JetStreamManager,
  options: EnsureConsumerOptions,
): Promise<void> {
  const {
    stream,
    durableName,
    filterSubject,
    filterSubjects,
    maxDeliver = 5,
  } = options;
  try {
    await jsm.consumers.add(stream, {
      durable_name: durableName,
      deliver_policy: DeliverPolicy.All,
      ack_policy: AckPolicy.Explicit,
      replay_policy: ReplayPolicy.Instant,
      max_deliver: maxDeliver,
      ...(filterSubject ? { filter_subject: filterSubject } : {}),
      ...(filterSubjects
        ? { filter_subjects: [...filterSubjects] }
        : {}),
    });
  } catch {
    // consumer already exists
  }
}
