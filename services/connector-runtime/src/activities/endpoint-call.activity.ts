import { PinoLoggerService } from "@yoizen/observability";
import type { EndpointCallArgs, EventCausalContext } from "@yoizen/shared";
import type { IEndpointCallResult } from "../lib/endpoint-call-core";
import { executeEndpointCallCore } from "../lib/endpoint-call-core";
import { publishEndpointCallEvent } from "./_shared/event-publisher";
import { mapEndpointCallErrorToApplicationFailure } from "./map-endpoint-call-error-to-application-failure";

const logger = new PinoLoggerService("endpoint-call.activity");

/**
 * Temporal activity: performs an HTTP call, optionally resolved via
 * {@link AdapterClient}. Three supported shapes:
 *  1. `adapterId` + `endpointId` → fully resolved via the adapter's
 *     endpoint definition (method/path/headers/timeouts all come from
 *     the adapter; `args.url` is ignored).
 *  2. `adapterId` (no `endpointId`) + `url` as a path → adapter's
 *     `baseUrl` is joined with `url` and `args.method` is used verbatim.
 *     Honours the adapter's headers, auth, timeouts and retry policy.
 *  3. No `adapterId` → raw `fetch` against `args.url`, which MUST be
 *     absolute (`http(s)://…`). Fixed 30 s timeout with no retries,
 *     same semantics as pre-adapter refactor.
 *
 * A distributed circuit breaker gates every call at tenant+target
 * granularity. When OPEN we fast-fail with a RETRYABLE
 * `ApplicationFailure` carrying `nextRetryDelay = breaker.cooldownMs`
 * so Temporal releases the activity slot in milliseconds AND
 * reschedules the next attempt right after the cooldown window —
 * letting the breaker cycle back to HALF_OPEN/CLOSED without
 * burning the workflow's retry budget on default exponential
 * backoff (which would just hit DENY again before the cooldown
 * expires). The breaker stays a TRANSIENT signal, not a kill
 * switch.
 *
 * This activity is a THIN WRAPPER (`manual-loops/connector-invoke-api.md`
 * T01): all execution logic (breaker, cache, URL-resolution branches,
 * audit event) lives in the pure `src/lib/endpoint-call-core` lib, which
 * returns a `Result` and never throws. This function's only job is
 * unwrapping that `Result` into Temporal's `ApplicationFailure` shape —
 * preserving today's exact `type`/`nonRetryable`/`nextRetryDelay` fields
 * so calling workflows see no behavior change.
 *
 * @param args - Method, URL, body, optional adapter/endpoint ids.
 * @param tenantId - Injected tenant for adapter resolution and `x-yoizen-tenant`.
 * @param causal - Causal context from the calling workflow's `endpointCall`/
 *   `serviceCall` action (when present), mirroring `mcp-call.activity.ts`'s
 *   `causal` param. Threaded into the published `endpoint_call_completed`
 *   event so it joins the run's correlation chain instead of becoming a
 *   causal orphan.
 * @returns Normalized status, body, and string headers.
 */
export async function executeEndpointCall(
  args: EndpointCallArgs,
  tenantId: string,
  causal?: EventCausalContext,
  executionId?: string
): Promise<IEndpointCallResult> {
  if (executionId) {
    logger.log(`endpointCall executionId=${executionId} tenant=${tenantId}`);
  }

  const result = await executeEndpointCallCore(
    args,
    tenantId,
    causal,
    publishEndpointCallEvent
  );

  if (result.ok) {
    return result.value;
  }

  throw mapEndpointCallErrorToApplicationFailure(result.error);
}
