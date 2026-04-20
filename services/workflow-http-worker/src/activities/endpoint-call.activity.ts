import { ApplicationFailure } from "@temporalio/activity";
import { TENANT_HEADER, computeBreakerKey } from "@yoizen/shared";
import type { EndpointCallArgs } from "@yoizen/shared";
import { getAdapterClient } from "./_shared/adapter-client.provider";
import { getHttpBreaker } from "./_shared/breaker";
import {
  applyJsonBody,
  buildUrl,
  httpCallWithRetry,
  type IHttpCallResult,
} from "./_shared/http-call-with-retry";
import { tracedFetch } from "@yoizen/observability";

type IEndpointCallResult = IHttpCallResult;

const RAW_TIMEOUT_MS = 30_000;

/**
 * Temporal activity: performs an HTTP call, optionally resolved via
 * {@link AdapterClient}. Raw calls (no adapter/endpoint) use a fixed
 * 30s timeout with no retries — same semantics as before refactor.
 *
 * A distributed circuit breaker gates every call at tenant+target
 * granularity. When OPEN we fast-fail with a non-retryable
 * `ApplicationFailure` so Temporal releases the activity slot in
 * milliseconds rather than burning the full `timeoutMs × maxAttempts`
 * budget (~90 s per call) against a known-dead upstream.
 *
 * @param args - Method, URL, body, optional adapter/endpoint ids.
 * @param tenantId - Injected tenant for adapter resolution and `x-yoizen-tenant`.
 * @returns Normalized status, body, and string headers.
 */
export async function executeEndpointCall(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  const breaker = getHttpBreaker();
  const key = computeBreakerKey({
    tenantId,
    kind: "endpoint",
    adapterId: args.adapterId,
    endpointId: args.endpointId,
    url: args.adapterId && args.endpointId ? undefined : args.url,
  });

  const decision = await breaker.canProceed(key);
  if (decision.action === "deny") {
    throw ApplicationFailure.nonRetryable(
      `Circuit breaker ${decision.status} for endpoint call (${decision.reason})`,
      "CIRCUIT_OPEN",
      { key, status: decision.status, reason: decision.reason },
    );
  }

  try {
    const result =
      args.adapterId && args.endpointId
        ? await executeWithAdapter(args, tenantId)
        : await executeRaw(args, tenantId);
    breaker.recordSuccess(key);
    return result;
  } catch (err) {
    breaker.recordFailure(key);
    throw err;
  }
}

async function executeWithAdapter(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  const client = getAdapterClient();
  const resolved = await client.resolveRequest(
    tenantId,
    args.adapterId!,
    args.endpointId!,
  );

  const mergedHeaders: Record<string, string> = {
    ...resolved.headers,
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(resolved.url, args.params);
  const body = applyJsonBody(args.data, mergedHeaders);

  return httpCallWithRetry({
    url,
    method: resolved.method,
    headers: mergedHeaders,
    body,
    timeoutMs: resolved.timeoutMs,
    maxRetries: resolved.maxRetries,
    retryBackoffMs: resolved.retryBackoffMs,
  });
}

async function executeRaw(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(args.url, args.params);
  const body = applyJsonBody(args.data, headers);

  const res = await tracedFetch(url, {
    method: args.method,
    headers,
    body,
    signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  let data: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: responseHeaders };
}
