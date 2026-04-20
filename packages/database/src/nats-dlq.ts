import type { JetStreamManager } from "nats";
import { RetentionPolicy } from "nats";
import {
  buildDlqStreamName,
  buildDlqSubjectPattern,
  DLQ_TENANT_STREAM_MAX_AGE_NS,
  DLQ_TENANT_STREAM_MAX_BYTES,
} from "@yoizen/shared";

/**
 * In-memory set of tenant DLQ streams already provisioned by this
 * process. O(1) lookup → avoids the JetStream `streams.info` RTT on
 * every terminated message.
 */
const ensuredDlqStreams = new Set<string>();

/** @internal test-only reset hook. */
export function __resetEnsuredDlqStreamCacheForTests(): void {
  ensuredDlqStreams.clear();
}

/**
 * Idempotently ensures a per-tenant dead-letter JetStream stream
 * (`DLQ-<tenantId>`) exists. Subjects match `dlq.<tenantId>.>` so
 * every stage can publish without additional config. Safe to call
 * under race: creation uses try/info-then-add.
 *
 * Big-O: after the first hit, amortized O(1) per call.
 */
export async function ensureTenantDlqStream(
  jsm: JetStreamManager,
  tenantId: string,
): Promise<string> {
  const name = buildDlqStreamName(tenantId);
  if (ensuredDlqStreams.has(name)) return name;

  try {
    await jsm.streams.info(name);
  } catch {
    try {
      await jsm.streams.add({
        name,
        subjects: [buildDlqSubjectPattern(tenantId)],
        retention: RetentionPolicy.Limits,
        max_age: DLQ_TENANT_STREAM_MAX_AGE_NS,
        max_bytes: DLQ_TENANT_STREAM_MAX_BYTES,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already") && !msg.includes("in use")) {
        throw err;
      }
    }
  }

  ensuredDlqStreams.add(name);
  return name;
}
