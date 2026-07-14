// Maps a pure-core `EndpointCallError` (`src/lib/endpoint-call-core/types.ts`)
// onto an HTTP status + body for the invoke facade
// (`manual-loops/connector-invoke-api.md` T02). Kept as a pure lib function
// (no `Response` construction here) so the status mapping is unit-testable
// without sockets — `src/http-main.ts` turns the returned shape into a
// `Response`.
//
// Status choices:
//   - breaker_open  -> 503 Service Unavailable (+ `retryAfterMs`, mirrors the
//                      Temporal wrapper's `nextRetryDelay` — caller should
//                      back off, this is a transient signal not a hard fail)
//   - invalid_args  -> 400 Bad Request (caller error, non-retryable)
//   - http_error    -> 502 Bad Gateway (the upstream target failed)
//   - timeout       -> 504 Gateway Timeout (the upstream target didn't
//                      respond in time)

import type { EndpointCallError } from "../endpoint-call-core";

export interface HttpErrorResponse {
  readonly status: 400 | 502 | 503 | 504;
  readonly body: {
    readonly error: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
    readonly retryAfterMs?: number;
  };
}

export function mapEndpointCallErrorToHttpResponse(
  error: EndpointCallError
): HttpErrorResponse {
  switch (error.kind) {
    case "breaker_open":
      return {
        status: 503,
        body: {
          error: "circuit_open",
          message: `Circuit breaker ${error.status} for endpoint call (${error.reason})`,
          retryAfterMs: error.cooldownMs,
        },
      };
    case "invalid_args":
      return {
        status: 400,
        body: {
          error: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
        },
      };
    case "http_error":
      return {
        status: 502,
        body: {
          error: "upstream_http_error",
          message: error.message,
        },
      };
    case "timeout":
      return {
        status: 504,
        body: {
          error: "upstream_timeout",
          message: error.message,
        },
      };
  }
}
