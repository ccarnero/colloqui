import type { EndpointCallError } from "./types";

/**
 * Classifies an error thrown by adapter resolution or `httpCallWithRetry`
 * (network failure, `HTTP 5xx` after retries exhausted, or an
 * `AbortSignal.timeout` abort) into a `timeout` vs `http_error` Result
 * variant. `cause` always carries the original error so the activity
 * wrapper can rethrow it unchanged — today's behavior is a plain
 * (unwrapped) rethrow for these paths, so the wrapper must reproduce that
 * exactly rather than re-package it into a new Error/ApplicationFailure.
 */
export function classifyHttpError(cause: unknown): EndpointCallError {
  const isTimeout =
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError");

  return isTimeout
    ? { kind: "timeout", message: cause.message, cause }
    : {
        kind: "http_error",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      };
}
