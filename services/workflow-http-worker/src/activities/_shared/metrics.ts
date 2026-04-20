import type { Counter } from "@opentelemetry/api";
import { getMeter } from "@yoizen/observability";

const meter = getMeter("workflow-http-worker");

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
