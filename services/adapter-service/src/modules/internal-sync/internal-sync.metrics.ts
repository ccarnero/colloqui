import { getMeter } from "@yoizen/observability";

const meter = getMeter("adapter-service");

/**
 * Counts internal-mirror sync events handled from registry-service,
 * tagged by kind (`upserted`/`deleted`) and outcome (`ok`/`skipped`/`error`).
 */
export const adapterInternalMirrorEventsTotal = meter.createCounter(
  "adapter_internal_mirror_events_total",
  {
    description:
      "Total registry→adapter sync events processed (tagged by kind and result)",
  },
);

/** Histogram of mirror upsert latency (DB + cache invalidation). */
export const adapterInternalMirrorSyncDurationMs = meter.createHistogram(
  "adapter_internal_mirror_sync_duration_ms",
  { description: "Duration of the mirror upsert/delete in ms" },
);
