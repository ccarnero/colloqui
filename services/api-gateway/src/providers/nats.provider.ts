import type { NatsConnection, JetStreamClient } from "nats";
import type { JetStreamManager } from "nats";
import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  ensureStream,
  NATS_CONNECTION,
} from "@yoizen/database";
import {
  GATEWAY_AUDIT_STREAM_NAME,
  GATEWAY_AUDIT_STREAM_SUBJECTS,
  GATEWAY_AUDIT_STREAM_MAX_BYTES,
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  getTenantStreamName,
  getTenantSubjectPattern,
} from "@yoizen/shared";

export { NATS_CONNECTION } from "@yoizen/database";
export const JETSTREAM_MANAGER = "JETSTREAM_MANAGER";
export const JETSTREAM = "JETSTREAM";

/** O(1) lookup cache of tenants whose INGRESS stream was ensured. */
const ensuredTenantIngressStreams = new Set<string>();

/**
 * Idempotent per-tenant `INGRESS-<tenant>` stream ensure (wdocs 01 §4).
 * Safe to call on every publish — first call creates, subsequent calls
 * short-circuit via the in-memory Set.
 */
export async function ensureTenantIngressStream(
  jsm: JetStreamManager,
  tenantId: string,
): Promise<void> {
  const streamName = getTenantStreamName(tenantId);
  if (ensuredTenantIngressStreams.has(streamName)) return;
  try {
    await jsm.streams.info(streamName);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("not found") && !msg.includes("no stream")) throw err;
    await jsm.streams.add({
      name: streamName,
      subjects: [getTenantSubjectPattern(tenantId)],
      retention: RetentionPolicy.Limits,
      max_age: CHANNEL_STREAM_MAX_AGE_NS,
      max_bytes: CHANNEL_STREAM_MAX_BYTES,
    });
  }
  ensuredTenantIngressStreams.add(streamName);
}

export const natsProvider: FactoryProvider = createNatsConnectionProvider("api-gateway");

export const jetStreamManagerProvider: FactoryProvider = {
  provide: JETSTREAM_MANAGER,
  inject: [NATS_CONNECTION],
  useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm, {
      name: GATEWAY_AUDIT_STREAM_NAME,
      subjects: GATEWAY_AUDIT_STREAM_SUBJECTS,
      maxBytes: GATEWAY_AUDIT_STREAM_MAX_BYTES,
    });
    return jsm;
  },
};

/** Depends on JETSTREAM_MANAGER so stream ensure runs before JetStream is used. */
export const jetStreamProvider: FactoryProvider = {
  provide: JETSTREAM,
  inject: [NATS_CONNECTION, JETSTREAM_MANAGER],
  useFactory: (
    nc: NatsConnection,
    _jsm: JetStreamManager,
  ): JetStreamClient => nc.jetstream(),
};
