import { metrics } from "@opentelemetry/api";

/**
 * OpenTelemetry instruments for the usage aggregator. Emitted via
 * the global meter provider wired by `ObservabilityModule` and
 * exported to Prometheus by the platform's OTLP collector.
 *
 * Instrument names follow the `usage_aggregator_*` Prometheus
 * convention (dots → underscores in the exporter), e.g.
 * `usage_aggregator_batch_duration_milliseconds`.
 */
const meter = metrics.getMeter("usage-aggregator-service");

const eventsTotal = meter.createCounter("usage_aggregator.events.total", {
  description:
    "Total channel events observed on tenant streams, labeled by " +
    "direction (ingress|egress|dlq) and final outcome (persisted|duplicate|parse_error|insert_error).",
});

const parseFailures = meter.createCounter(
  "usage_aggregator.parse_failures.total",
  {
    description:
      "Messages whose envelope could not be parsed into a usage row. " +
      "Labeled by reason (missing-accountid, unknown-kind, …).",
  },
);

const skipped = meter.createCounter("usage_aggregator.skipped.total", {
  description:
    "Messages intentionally ignored (not a failure): non-channel " +
    "subjects on INGRESS streams, intent-only kinds like `send`, " +
    "etc. Labeled by reason. Tracked separately from parse_failures " +
    "so alerting on parse errors stays signal-rich.",
});

const insertFailures = meter.createCounter(
  "usage_aggregator.insert_failures.total",
  {
    description: "Batch insert failures, labeled by tenant.",
  },
);

const batchDuration = meter.createHistogram(
  "usage_aggregator.batch.duration",
  {
    description: "End-to-end duration of a batch flush, in milliseconds.",
    unit: "ms",
  },
);

/**
 * Gauge-style up/down counter: we emit the *delta* from the last
 * observed value per label set, which renders in Prometheus as a
 * monotonically tracked current-lag gauge. Keeping per-key state
 * in a Map gives O(1) lookups on the hot path.
 */
const consumerLag = meter.createUpDownCounter(
  "usage_aggregator.consumer.lag",
  {
    description:
      "Current NATS pending-message lag for the aggregator's durable, " +
      "sampled on each batch flush. Labeled by tenant + direction.",
  },
);

const lastEventTs = meter.createUpDownCounter(
  "usage_aggregator.last_event.timestamp_ms",
  {
    description:
      "Wall-clock timestamp of the most-recently-persisted event " +
      "(milliseconds since epoch). Lets freshness dashboards detect " +
      "stalled tenants.",
  },
);

const lastLag = new Map<string, number>();
const lastTs = new Map<string, number>();

export interface IAggregatorMetricsSink {
  recordPersisted(tenant: string, direction: string, count: number): void;
  recordDuplicate(tenant: string, direction: string, count: number): void;
  recordParseFailure(reason: string, count?: number): void;
  recordSkipped(reason: string, count?: number): void;
  recordInsertFailure(tenant: string, count?: number): void;
  recordBatchDurationMs(tenant: string, direction: string, ms: number): void;
  recordLag(tenant: string, direction: string, pending: number): void;
  recordLastEventTs(tenant: string, tsMs: number): void;
}

const defaultCount = (v: number | undefined): number =>
  v === undefined ? 1 : v;

export const aggregatorMetrics: IAggregatorMetricsSink = {
  recordPersisted(tenant, direction, count) {
    if (count === 0) return;
    eventsTotal.add(count, { tenant, direction, outcome: "persisted" });
  },
  recordDuplicate(tenant, direction, count) {
    if (count === 0) return;
    eventsTotal.add(count, { tenant, direction, outcome: "duplicate" });
  },
  recordParseFailure(reason, count) {
    const n = defaultCount(count);
    eventsTotal.add(n, {
      tenant: "unknown",
      direction: "unknown",
      outcome: "parse_error",
    });
    parseFailures.add(n, { reason });
  },
  recordSkipped(reason, count) {
    skipped.add(defaultCount(count), { reason });
  },
  recordInsertFailure(tenant, count) {
    const n = defaultCount(count);
    eventsTotal.add(n, {
      tenant,
      direction: "unknown",
      outcome: "insert_error",
    });
    insertFailures.add(n, { tenant });
  },
  recordBatchDurationMs(tenant, direction, ms) {
    batchDuration.record(ms, { tenant, direction });
  },
  recordLag(tenant, direction, pending) {
    const key = `${tenant}|${direction}`;
    const previous = lastLag.get(key) ?? 0;
    const delta = pending - previous;
    if (delta !== 0) {
      consumerLag.add(delta, { tenant, direction });
      lastLag.set(key, pending);
    }
  },
  recordLastEventTs(tenant, tsMs) {
    const previous = lastTs.get(tenant) ?? 0;
    const delta = tsMs - previous;
    if (delta !== 0) {
      lastEventTs.add(delta, { tenant });
      lastTs.set(tenant, tsMs);
    }
  },
};
