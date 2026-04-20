import { metrics } from "@opentelemetry/api";

/**
 * Outcome label. Must match the values used by `NatsConsumerRunner`
 * in `@yoizen/database`. Kept in sync manually (both packages are
 * internal, no runtime import needed to avoid circular deps).
 */
export type NatsMessageResult = "ack" | "nak" | "term";

/**
 * Shape returned to callers; compatible with `INatsConsumerMetrics`
 * from `@yoizen/database/nats-consumer-runner` (structural typing).
 *
 * All methods are O(1) and non-throwing — OpenTelemetry SDK buffers
 * writes internally and the view/export pipeline runs on a separate
 * batch timer so the hot path is never blocked on metric emission.
 */
export interface INatsConsumerMetricsSink {
  recordProcessed(durable: string, result: NatsMessageResult): void;
  recordDuration(durable: string, ms: number): void;
  adjustInFlight(durable: string, delta: number): void;
}

/**
 * Per-process registry so the factory is idempotent. Calling
 * `createNatsConsumerMetrics` twice with the same service name
 * returns the same sink (same underlying instruments) rather than
 * registering duplicate metrics against the OTEL meter provider.
 *
 * Keyed by service name → O(1) lookup via `Map`.
 */
const cache = new Map<string, INatsConsumerMetricsSink>();

/**
 * Returns an OpenTelemetry-backed metrics sink for
 * `NatsConsumerRunner` / `MultiTenantConsumerManager`.
 *
 * Emits three instruments, labeled by `durable` + (for processed) `result`:
 *
 *   - `nats.consumer.messages.processed` (counter)
 *   - `nats.consumer.processing.duration` (histogram, ms)
 *   - `nats.consumer.in_flight` (up/down counter)
 *
 * Via the OTLP → Prometheus collector pipeline already configured in
 * the platform, these surface in Prometheus as:
 *
 *   - `nats_consumer_messages_processed_total{durable, result}`
 *   - `nats_consumer_processing_duration_milliseconds_bucket{durable, le}`
 *   - `nats_consumer_in_flight{durable}`
 */
export function createNatsConsumerMetrics(
  serviceName: string,
): INatsConsumerMetricsSink {
  const cached = cache.get(serviceName);
  if (cached) return cached;

  const meter = metrics.getMeter(serviceName);

  const processed = meter.createCounter("nats.consumer.messages.processed", {
    description:
      "Total messages processed by a JetStream durable consumer, " +
      "labeled by durable name and terminal result (ack/nak/term).",
  });

  const duration = meter.createHistogram(
    "nats.consumer.processing.duration",
    {
      description:
        "End-to-end handler latency for a JetStream durable " +
        "consumer, in milliseconds.",
      unit: "ms",
    },
  );

  const inFlight = meter.createUpDownCounter("nats.consumer.in_flight", {
    description:
      "Concurrent in-flight messages being processed by a durable " +
      "consumer. Rises on dispatch, falls on ack/nak/term.",
  });

  const sink: INatsConsumerMetricsSink = {
    recordProcessed(durable, result) {
      processed.add(1, { durable, result });
    },
    recordDuration(durable, ms) {
      duration.record(ms, { durable });
    },
    adjustInFlight(durable, delta) {
      inFlight.add(delta, { durable });
    },
  };

  cache.set(serviceName, sink);
  return sink;
}

/**
 * @internal Test helper to reset the cache so factory tests can
 * assert idempotency behavior without cross-test pollution.
 */
export function __resetNatsConsumerMetricsCacheForTests(): void {
  cache.clear();
}
