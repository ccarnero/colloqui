import type { NatsConnection, JetStreamClient, JetStreamManager } from "nats";
import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  NATS_CONNECTION,
} from "@yoizen/database";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  getTenantStreamName,
  getTenantSubjectPattern,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM_PUBLISHER = "JETSTREAM_PUBLISHER";

export const natsProvider: FactoryProvider = createNatsConnectionProvider();

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> =>
    nc.jetstreamManager(),
};

/**
 * Ensures a per-tenant INGRESS stream exists.
 * Called lazily on first publish for a given tenant.
 */
async function ensureIngressStream(
  jsm: JetStreamManager,
  streamName: string,
  subjects: string[],
): Promise<void> {
  try {
    await jsm.streams.info(streamName);
    return;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("not found") && !msg.includes("no stream")) {
      throw err;
    }
  }

  await jsm.streams.add({
    name: streamName,
    subjects,
    retention: RetentionPolicy.Limits,
    max_age: CHANNEL_STREAM_MAX_AGE_NS,
    max_bytes: CHANNEL_STREAM_MAX_BYTES,
  });
}

/** Tracks tenants whose INGRESS stream was already ensured (O(1) lookup). */
const ensuredTenantIngressStreams = new Set<string>();

/**
 * Idempotent per-tenant INGRESS stream ensure (ingress + egress).
 */
export async function ensureTenantIngressStream(
  jsm: JetStreamManager,
  tenantId: string,
): Promise<void> {
  const streamName = getTenantStreamName(tenantId);
  if (ensuredTenantIngressStreams.has(streamName)) return;
  const subjects = [getTenantSubjectPattern(tenantId)];
  await ensureIngressStream(jsm, streamName, subjects);
  ensuredTenantIngressStreams.add(streamName);
}

export const jetStreamPublisherProvider: FactoryProvider = {
  provide: JETSTREAM_PUBLISHER,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (nc: NatsConnection, _jsm: JetStreamManager): JetStreamClient =>
    nc.jetstream(),
};
