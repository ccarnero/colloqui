import { metrics } from "@opentelemetry/api";

/**
 * Structural mirror of `BreakerStatus` from
 * `@yoizen/shared/circuit-breaker` — duplicated to avoid a
 * cross-package import cycle at runtime. The value set is tiny and
 * stable; both declarations are checked by tests on both sides.
 */
export type BreakerStatus = "closed" | "open" | "half_open";

export interface ICircuitBreakerMetricsSink {
  recordDecision(
    key: string,
    action: "allow" | "deny",
    status: BreakerStatus,
    reason: string,
  ): void;
  recordTransition(key: string, from: BreakerStatus, to: BreakerStatus): void;
  recordL1Hit(key: string): void;
  recordRedisError(): void;
  recordDecideDuration(ms: number): void;
}

/**
 * Per-service cache → idempotent factory, same pattern as
 * `createNatsConsumerMetrics`. Returning the same sink on repeat
 * calls avoids double-registering OTEL instruments.
 */
const cache = new Map<string, ICircuitBreakerMetricsSink>();

/**
 * @returns An OTEL-backed sink compatible with `ICircuitBreakerMetrics`
 * from `@yoizen/shared/circuit-breaker`. Emits:
 *
 *   - `circuit_breaker.decisions` (counter, labels: key, action, status, reason)
 *   - `circuit_breaker.transitions` (counter, labels: key, from, to)
 *   - `circuit_breaker.l1_hits` (counter, labels: key)
 *   - `circuit_breaker.redis_errors` (counter)
 *   - `circuit_breaker.decide_duration` (histogram, ms)
 *
 * Note on cardinality: `key` can be high-cardinality (per tenant /
 * per endpoint). In prod we recommend configuring an OTEL view that
 * drops the `key` label on hot-path counters if the emitter volume
 * is high; the breaker key is already embedded in the Redis hash so
 * no observability is lost by dropping it from the metric labels.
 */
export function createCircuitBreakerMetrics(
  serviceName: string,
): ICircuitBreakerMetricsSink {
  const cached = cache.get(serviceName);
  if (cached) return cached;

  const meter = metrics.getMeter(serviceName);

  const decisions = meter.createCounter("circuit_breaker.decisions", {
    description:
      "Circuit breaker decisions (allow/deny), labeled by key, action, " +
      "resulting status, and reason.",
  });
  const transitions = meter.createCounter("circuit_breaker.transitions", {
    description:
      "Circuit breaker state transitions (closed/open/half_open).",
  });
  const l1Hits = meter.createCounter("circuit_breaker.l1_hits", {
    description:
      "Decisions served from the in-process 500 ms L1 cache without " +
      "a Redis round trip.",
  });
  const redisErrors = meter.createCounter("circuit_breaker.redis_errors", {
    description:
      "Redis errors encountered by the circuit breaker. Each increment " +
      "triggered a fallback to the local in-memory breaker.",
  });
  const decideDuration = meter.createHistogram(
    "circuit_breaker.decide_duration",
    {
      description: "Latency of `canProceed` calls end-to-end.",
      unit: "ms",
    },
  );

  const sink: ICircuitBreakerMetricsSink = {
    recordDecision(key, action, status, reason) {
      decisions.add(1, { key, action, status, reason });
    },
    recordTransition(key, from, to) {
      transitions.add(1, { key, from, to });
    },
    recordL1Hit(key) {
      l1Hits.add(1, { key });
    },
    recordRedisError() {
      redisErrors.add(1);
    },
    recordDecideDuration(ms) {
      decideDuration.record(ms);
    },
  };

  cache.set(serviceName, sink);
  return sink;
}

/**
 * @internal Test hook.
 */
export function __resetCircuitBreakerMetricsCacheForTests(): void {
  cache.clear();
}
