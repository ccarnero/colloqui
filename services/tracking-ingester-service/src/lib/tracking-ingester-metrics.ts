// OpenTelemetry metrics sink for the tracking ingester (T07). Follows the repo
// convention (services/usage-aggregator-service/.../aggregator.metrics.ts and
// packages/observability/src/nats-consumer-metrics.ts): instruments are created
// once off the global meter and exported to Prometheus by the platform's OTLP
// collector (dots → underscores; counters gain a `_total` suffix).
//
// The sink is an interface so the consumer edge stays decoupled and unit tests
// inject a fake to assert the alarm fires. `createTrackingIngesterMetrics`
// returns the OTEL-backed implementation; `noopTrackingIngesterMetrics` is the
// default for callers that have not wired telemetry.

import { getMeter } from "@yoizen/observability";
import type { ProcessOutcome } from "./process-tracked-message.js";

/** Why an `unknown`-alarm counter tick was recorded. */
export type UnknownReason = "classification" | "malformed";

export interface ITrackingIngesterMetricsSink {
  /** One tick per processed message, labeled by pipeline outcome. */
  recordProcessed(outcome: ProcessOutcome): void;
  /**
   * The alarm signal (`tracking_ingester_unknown_total`). `classification` =
   * a compliant envelope with an unrecognized shape (rules 16/17/18);
   * `malformed` = drift that failed `isCompliantEnvelope`. Any non-zero value
   * is actionable (TAXONOMY.md §3).
   */
  recordUnknown(reason: UnknownReason): void;
  /** Transient insert failure that triggered a nak. */
  recordInsertFailure(): void;
}

/** No-op sink — safe default when telemetry is not wired. */
export const noopTrackingIngesterMetrics: ITrackingIngesterMetricsSink = {
  recordProcessed() {},
  recordUnknown() {},
  recordInsertFailure() {},
};

/**
 * OTEL-backed sink. Emits:
 *   - `tracking_ingester_processed_total{outcome}`
 *   - `tracking_ingester_unknown_total{reason}`  (the alarm)
 *   - `tracking_ingester_insert_failures_total`
 */
export function createTrackingIngesterMetrics(
  serviceName = "tracking-ingester-service"
): ITrackingIngesterMetricsSink {
  const meter = getMeter(serviceName);

  const processed = meter.createCounter("tracking_ingester.processed", {
    description:
      "Total messages processed by the tracking ingester, labeled by " +
      "pipeline outcome (canonical|non_envelope|unknown|malformed).",
  });

  const unknown = meter.createCounter("tracking_ingester.unknown", {
    description:
      "Unrecognized traffic the ingester could not classify to a known " +
      "family — the drift alarm. Labeled by reason (classification|malformed). " +
      "Any non-zero value is actionable (TAXONOMY.md §3).",
  });

  const insertFailures = meter.createCounter(
    "tracking_ingester.insert_failures",
    {
      description:
        "Transient insert failures that triggered a NATS nak (message will " +
        "be redelivered).",
    }
  );

  return {
    recordProcessed(outcome) {
      processed.add(1, { outcome });
    },
    recordUnknown(reason) {
      unknown.add(1, { reason });
    },
    recordInsertFailure() {
      insertFailures.add(1);
    },
  };
}
