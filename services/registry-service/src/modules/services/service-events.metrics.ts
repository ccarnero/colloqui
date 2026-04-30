import type { Counter } from "@opentelemetry/api";
import { Injectable } from "@nestjs/common";
import { getMeter } from "@yoizen/observability";

/**
 * Frozen string-literal map of failure-reason labels for
 * `registry_publish_failures_total{reason}`. Using a `const` map +
 * derived union type avoids stringly-typed call sites and keeps
 * label-cardinality bounded for the Prometheus exporter.
 *
 * @see REQ-RSE-001, REQ-RSE-002, REQ-RSE-005, NFR-RSE-001
 */
export const ServiceEventsPublishFailureReason = {
  ACK_TIMEOUT: "ack_timeout",
  BROKER_UNAVAILABLE: "broker_unavailable",
  ENSURE_STREAM_FAILED: "ensure_stream_failed",
  MISSING_TENANT: "missing_tenant",
  UNKNOWN: "unknown",
} as const;

export type ServiceEventsPublishFailureReasonValue =
  (typeof ServiceEventsPublishFailureReason)[keyof typeof ServiceEventsPublishFailureReason];

/**
 * Frozen string-literal map of stream-ensure outcomes for
 * `registry_ensure_stream_calls_total{result}`. `hit` => served from
 * the per-publisher cache (zero broker round-trip); `miss` => the
 * shared `ensureTenantIngressStream` helper was invoked.
 */
export const ServiceEventsEnsureStreamResult = {
  HIT: "hit",
  MISS: "miss",
} as const;

export type ServiceEventsEnsureStreamResultValue =
  (typeof ServiceEventsEnsureStreamResult)[keyof typeof ServiceEventsEnsureStreamResult];

const meter = getMeter("registry-service");

/**
 * Counters for `service-events.publisher` — one counter per concept
 * to keep the OTel `add()` call sites O(1) and aggregation downstream
 * (Prometheus) trivial.
 *
 * Wrapped in an `@Injectable()` class so the publisher resolves them
 * via DI and unit tests can substitute a fake via
 * `Test.createTestingModule({ providers: [{ provide: ServiceEventsMetrics, useValue: fake }] })`.
 *
 * @see NFR-RSE-001 — publisher observability.
 */
@Injectable()
export class ServiceEventsMetrics {
  /**
   * Total publish attempts (one per `publishUpserted`/`publishDeleted`
   * call that progresses past the feature-flag/missing-tenant gate).
   *
   * Labels: `event_type` (e.g. `io.yoizen.registry.service.upserted.v1`).
   */
  readonly publishAttempts: Counter = meter.createCounter(
    "registry_publish_attempts_total",
    {
      description:
        "Total registry-service service-lifecycle publish attempts (post-gate)",
    },
  );

  /**
   * Total successful publishes (PubAck received within the bounded
   * retry envelope). Labels: `event_type`.
   */
  readonly publishSuccesses: Counter = meter.createCounter(
    "registry_publish_successes_total",
    {
      description:
        "Total registry-service service-lifecycle publish successes (PubAck observed)",
    },
  );

  /**
   * Total terminal publish failures, classified by reason.
   *
   * Labels:
   *  - `event_type` — CloudEvents type token.
   *  - `reason` ∈ `ack_timeout` | `broker_unavailable` |
   *    `ensure_stream_failed` | `missing_tenant` | `unknown`.
   */
  readonly publishFailures: Counter = meter.createCounter(
    "registry_publish_failures_total",
    {
      description:
        "Total registry-service service-lifecycle publish failures by reason class",
    },
  );

  /**
   * Total `ensureTenantIngressStream` calls observed by the publisher,
   * tagged by cache result. Labels: `result` ∈ `hit` | `miss`.
   */
  readonly ensureStreamCalls: Counter = meter.createCounter(
    "registry_ensure_stream_calls_total",
    {
      description:
        "Total tenant-ingress-stream-ensure calls (hit = served from per-pod cache, miss = broker round-trip)",
    },
  );
}
