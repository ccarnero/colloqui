import {
  createNatsConsumerMetrics,
  getMeter,
  resolveServiceName,
  type INatsConsumerMetricsSink,
} from "@yoizen/observability";

/**
 * OTEL meter used for the **business-level** counters specific to the
 * registry → adapter mirror pipeline (success/skip/error tagged by kind
 * and a cross-tenant attempt tripwire). The runner-level counters
 * (`nats.consumer.messages.processed` / `…duration` / `…in_flight`)
 * live on a separate sink — see {@link adapterInternalSyncRunnerMetrics}.
 *
 * Resolved service name honours `OTEL_SERVICE_NAME` first
 * (`connector-admin-api` vs `connector-admin-worker`) so Prometheus
 * splits the series by deployment role automatically.
 */
const meter = getMeter(resolveServiceName("connector-admin"));

/**
 * Counts internal-mirror sync events handled from registry-service,
 * tagged by kind (`upserted`/`deleted`) and outcome (`ok`/`skipped`/`error`).
 *
 * NFR-ASIS-001: per-durable observability.
 */
export const adapterInternalMirrorEventsTotal = meter.createCounter(
  "adapter_internal_mirror_events_total",
  {
    description:
      "Total registry→adapter sync events processed (tagged by kind and result)",
  },
);

/** Histogram of mirror upsert/delete latency (DB + cache invalidation). */
export const adapterInternalMirrorSyncDurationMs = meter.createHistogram(
  "adapter_internal_mirror_sync_duration_ms",
  { description: "Duration of the mirror upsert/delete in ms" },
);

/**
 * Counter incremented every time a delivery's payload `tenantId` does
 * not match the subject's tenant token (REQ-ASIS-006). Labels:
 *
 *   - `tenant_subject` — tenant id parsed from the JetStream subject
 *     (the source of truth for routing).
 *   - `tenant_payload` — tenant id claimed by the envelope payload
 *     (the disputed value).
 *
 * Cardinality is bounded in practice because tenant ids are O(low
 * hundreds) and the counter only fires on actual mismatches (a
 * security/correctness anomaly, not a hot-path event).
 *
 * NFR-XC-003: cross-cutting observability surface.
 */
export const adapterInternalSyncCrossTenantAttemptTotal = meter.createCounter(
  "cross_tenant_attempt_total",
  {
    description:
      "Times a registry envelope's payload tenantId disagreed with the " +
      "subject tenant — the subject is authoritative; this fires on " +
      "every poison-message classified as cross_tenant_attempt.",
  },
);

/**
 * Runner-level metrics sink wired into
 * `IMultiTenantConsumerConfig.metrics`. Backed by the shared OTEL
 * factory in `@yoizen/observability` so the platform's existing
 * dashboards and alerts (`nats_consumer_messages_processed_total`,
 * `nats_consumer_processing_duration_milliseconds_bucket`,
 * `nats_consumer_in_flight`) work out of the box. The factory is
 * idempotent — a second call with the same service name returns the
 * same instruments rather than registering duplicates against the
 * meter provider (cache: O(1) `Map` lookup).
 *
 * NFR-ASIS-001 + NFR-XC-003.
 */
export const adapterInternalSyncRunnerMetrics: INatsConsumerMetricsSink =
  createNatsConsumerMetrics(resolveServiceName("connector-admin"));
