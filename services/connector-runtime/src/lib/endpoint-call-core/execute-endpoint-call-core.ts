import { PinoLoggerService } from "@yoizen/observability";
import type { EndpointCallArgs, EventCausalContext } from "@yoizen/shared";
import { computeBreakerKey } from "@yoizen/shared";
import { getHttpResponseCache } from "../../activities/_shared/adapter-client.provider";
import {
  getHttpBreaker,
  HTTP_BREAKER_COOLDOWN_MS,
} from "../../activities/_shared/breaker";
import type { IHttpResponseCache } from "../../activities/_shared/http-cache/http-response-cache";
import { err, type Result } from "../result";
import { executeRaw } from "./execute-raw";
import { executeWithAdapterBase } from "./execute-with-adapter-base";
import { executeWithAdapterEndpoint } from "./execute-with-adapter-endpoint";
import {
  type EndpointCallError,
  type EndpointCallEventSink,
  type IEndpointCallResult,
  noopEndpointCallEventSink,
} from "./types";

const logger = new PinoLoggerService("endpoint-call-core");

/**
 * Pure core of the endpoint-call execution pipeline — breaker gating, the
 * three URL-resolution branches (adapter+endpoint / adapter-base / raw),
 * HTTP-response cache and the `connector.endpoint_call.completed.v1` audit
 * event all live here so BOTH the Temporal activity and the future sync/
 * async HTTP flavors (`manual-loops/connector-invoke-api.md`) are governed
 * identically. No Temporal/NATS/Express imports anywhere in this lib's
 * import graph: the audit event is published through the injected `publish`
 * port (`EndpointCallEventSink`, defaulting to a no-op) rather than calling
 * the NATS-backed `publishEndpointCallEvent` directly — entrypoints (today:
 * the Temporal activity wrapper) inject the real sink AND translate the
 * returned `Result` into their own error shape (`ApplicationFailure` for
 * Temporal).
 *
 * @param args - Method, URL, body, optional adapter/endpoint ids.
 * @param tenantId - Injected tenant for adapter resolution and `x-yoizen-tenant`.
 * @param causal - Causal context from the calling workflow's `endpointCall`/
 *   `serviceCall` action (when present), threaded into the published
 *   `endpoint_call_completed` event so it joins the run's correlation chain
 *   instead of becoming a causal orphan.
 * @param publish - Audit-event sink injected by the entrypoint (real NATS
 *   publisher in production; defaults to a no-op so the core stays callable,
 *   and testable, without any NATS dependency).
 * @param httpResponseCache - Injected HTTP-response cache store, defaulting
 *   to the process-wide singleton (`getHttpResponseCache()`). Tests supply
 *   an isolated in-memory implementation instead of mutating the singleton
 *   in place (`manual-loops/connector-invoke-api.md` T01 review round 2).
 * @param invocationId - Set by standalone (non-workflow) callers — today the
 *   HTTP facade (T02) — so the published audit event's envelope `resource`
 *   is addressable by invocation. `undefined` (the Temporal activity's
 *   behavior) preserves the pre-T02 `adapter/${adapterId}` resource shape.
 * @returns `Result<IEndpointCallResult, EndpointCallError>` — never throws.
 */
export async function executeEndpointCallCore(
  args: EndpointCallArgs,
  tenantId: string,
  causal?: EventCausalContext,
  publish: EndpointCallEventSink = noopEndpointCallEventSink,
  httpResponseCache: IHttpResponseCache = getHttpResponseCache(),
  invocationId?: string
): Promise<Result<IEndpointCallResult, EndpointCallError>> {
  const hasAdapter = !!args.adapterId;
  const hasEndpoint = !!args.endpointId;

  const breaker = getHttpBreaker();
  const key = computeBreakerKey({
    tenantId,
    kind: "endpoint",
    adapterId: args.adapterId,
    endpointId: args.endpointId,
    url: hasAdapter && hasEndpoint ? undefined : args.url,
  });

  const decision = await breaker.canProceed(key);
  if (decision.action === "deny") {
    logger.warn(
      `breaker DENY for endpoint call key=${key} status=${decision.status} reason=${decision.reason}`
    );
    return err({
      kind: "breaker_open",
      key,
      status: decision.status,
      reason: decision.reason,
      cooldownMs: HTTP_BREAKER_COOLDOWN_MS,
    });
  }

  const result =
    hasAdapter && hasEndpoint
      ? await executeWithAdapterEndpoint(
          args,
          tenantId,
          causal,
          publish,
          httpResponseCache,
          invocationId
        )
      : hasAdapter
        ? await executeWithAdapterBase(
            args,
            tenantId,
            causal,
            publish,
            httpResponseCache,
            invocationId
          )
        : await executeRaw(args, tenantId, httpResponseCache);

  if (result.ok) {
    breaker.recordSuccess(key);
  } else {
    breaker.recordFailure(key);
  }
  return result;
}
