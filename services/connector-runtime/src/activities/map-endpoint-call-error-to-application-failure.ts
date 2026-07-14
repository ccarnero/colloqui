import { ApplicationFailure } from "@temporalio/activity";
import type { EndpointCallError } from "../lib/endpoint-call-core";

/**
 * Maps a pure-core `EndpointCallError` (`src/lib/endpoint-call-core`) onto
 * Temporal's `ApplicationFailure`, reproducing the exact fields the
 * pre-extraction `endpoint-call.activity.ts` threw so
 * `endpoint-call.activity.spec.ts` passes unchanged
 * (`manual-loops/connector-invoke-api.md` T01). This is the ONLY place in
 * the codebase importing both the core's error type and `@temporalio/
 * activity` — the core stays Temporal-free.
 */
export function mapEndpointCallErrorToApplicationFailure(
  error: EndpointCallError
): never {
  switch (error.kind) {
    case "breaker_open":
      throw ApplicationFailure.create({
        message: `Circuit breaker ${error.status} for endpoint call (${error.reason})`,
        type: "CIRCUIT_OPEN",
        nonRetryable: false,
        nextRetryDelay: error.cooldownMs,
        details: [
          { key: error.key, status: error.status, reason: error.reason },
        ],
      });
    case "invalid_args":
      throw ApplicationFailure.nonRetryable(
        error.message,
        error.code,
        error.details
      );
    case "http_error":
    case "timeout":
      // Pre-extraction behavior: these were unwrapped rethrows (Temporal's
      // own default conversion applied). Rethrow the original cause
      // unchanged rather than re-packaging it into a new ApplicationFailure.
      throw error.cause;
  }
}
