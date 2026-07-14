// Pure builder: turns the core's `Result<IEndpointCallResult, EndpointCallError>`
// into the Redis-parked `InvocationRecord` shape
// (`manual-loops/connector-invoke-api.md` T05). Kept separate from
// `handle-invoke-requested-message.ts` so the mapping is unit-testable in
// isolation, mirroring `map-endpoint-call-error-to-http-response.ts`'s role
// on the sync/facade side.

import type {
  EndpointCallError,
  IEndpointCallResult,
} from "../endpoint-call-core";
import type { Result } from "../result";
import type { InvocationRecord } from "./types";

export function buildInvocationCompletedRecord(
  tenantId: string,
  invocationId: string,
  coreResult: Result<IEndpointCallResult, EndpointCallError>,
  now: () => Date = () => new Date()
): Extract<InvocationRecord, { status: "completed" }> {
  const completedAt = now().toISOString();

  if (coreResult.ok) {
    return {
      status: "completed",
      tenantId,
      invocationId,
      completedAt,
      outcome: "ok",
      result: coreResult.value,
    };
  }

  return {
    status: "completed",
    tenantId,
    invocationId,
    completedAt,
    outcome: "error",
    error: {
      kind: coreResult.error.kind,
      message: describeEndpointCallError(coreResult.error),
    },
  };
}

function describeEndpointCallError(error: EndpointCallError): string {
  switch (error.kind) {
    case "breaker_open":
      return `circuit breaker ${error.status}: ${error.reason}`;
    case "invalid_args":
      return error.message;
    case "http_error":
      return error.message;
    case "timeout":
      return error.message;
  }
}
