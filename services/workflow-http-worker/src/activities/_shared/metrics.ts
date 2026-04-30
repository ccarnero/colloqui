import type { Counter } from "@opentelemetry/api";
import { getMeter } from "@yoizen/observability";

const meter = getMeter("workflow-http-worker");

export const HttpResponseCacheResult = {
  HIT: "hit",
  MISS: "miss",
  BYPASS: "bypass",
  STORE: "store",
  STORE_SKIP: "store_skip",
} as const;

export type HttpResponseCacheResultValue =
  (typeof HttpResponseCacheResult)[keyof typeof HttpResponseCacheResult];

export const HttpResponseCacheReason = {
  OK: "ok",
  DISABLED: "disabled",
  FLAG_OFF: "flag-off",
  METHOD: "method",
  STATUS: "status",
  REDIS_ERROR: "redis-error",
  UNSUPPORTED_TARGET: "unsupported-target",
} as const;

export type HttpResponseCacheReasonValue =
  (typeof HttpResponseCacheReason)[keyof typeof HttpResponseCacheReason];

/**
 * Counts how many `serviceCall` executions resolved via the
 * internal-adapter mirror vs. the legacy registry-service lookup.
 * Used to track adoption during the Option-D rollout.
 *
 * Labels: `source` ∈ {"mirror", "registry"}, `result` ∈ {"ok", "error"}.
 */
export const serviceCallResolutionSourceTotal: Counter = meter.createCounter(
  "service_call_resolution_source_total",
  {
    description:
      "Service-call resolutions tagged by path used: adapter mirror vs registry",
  },
);

export const httpResponseCacheTotal: Counter = meter.createCounter(
  "http_response_cache_total",
  {
    description:
      "HTTP response-cache decisions and outcomes for workflow-http-worker calls",
  },
);

export function recordHttpResponseCache(
  result: HttpResponseCacheResultValue,
  reason: HttpResponseCacheReasonValue,
  method: string,
): void {
  httpResponseCacheTotal.add(1, {
    result,
    reason,
    method: method.toUpperCase(),
  });
}
