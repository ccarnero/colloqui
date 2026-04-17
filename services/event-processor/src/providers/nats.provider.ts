import type { JetStreamManager } from "nats";
import { RetentionPolicy } from "nats";
import type { FactoryProvider } from "@nestjs/common";
import {
  createNatsConnectionProvider,
  createJetStreamManagerProvider,
  createJetStreamPublisherProvider,
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

export const natsProvider: FactoryProvider =
  createNatsConnectionProvider("event-processor");

export const jetStreamManagerProvider: FactoryProvider =
  createJetStreamManagerProvider(JETSTREAM_MANAGER, {
    streams: [],
    consumers: [],
  });

export const jetStreamPublisherProvider: FactoryProvider =
  createJetStreamPublisherProvider({
    provide: JETSTREAM_PUBLISHER,
    managerToken: JETSTREAM_MANAGER,
  });

/**
 * Ensures the per-tenant `INGRESS-<tenant>` stream exists before
 * publishing into it. Idempotent: a no-op when the stream has already
 * been provisioned (normally by api-gateway or channel-service).
 */
export async function ensureTenantIngressStream(
  jsm: JetStreamManager,
  tenantId: string,
): Promise<void> {
  const name = getTenantStreamName(tenantId);
  const subjects = [getTenantSubjectPattern(tenantId)];
  try {
    await jsm.streams.info(name);
  } catch {
    await jsm.streams.add({
      name,
      subjects,
      max_age: CHANNEL_STREAM_MAX_AGE_NS,
      max_bytes: CHANNEL_STREAM_MAX_BYTES,
      retention: RetentionPolicy.Limits,
    });
  }
}
