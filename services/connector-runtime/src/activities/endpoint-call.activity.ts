import { ApplicationFailure } from "@temporalio/activity";
import { TENANT_HEADER, computeBreakerKey } from "@yoizen/shared";
import type { EndpointCallArgs } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";
import { workflowHttpWorkerConfig } from "../config";
import {
  getAdapterClient,
  getHttpResponseCache,
} from "./_shared/adapter-client.provider";
import { getHttpBreaker, HTTP_BREAKER_COOLDOWN_MS } from "./_shared/breaker";
import {
  applyJsonBody,
  buildUrl,
  httpCallWithRetry,
  type IHttpCallResult,
} from "./_shared/http-call-with-retry";
import { cachedFetch } from "./_shared/http-cache/cached-fetch";
import {
  createBypassHttpResponseCacheDecision,
  resolveHttpResponseCachePolicy,
} from "./_shared/http-cache/cache-policy";
import { HttpResponseCacheReason } from "./_shared/metrics";

type IEndpointCallResult = IHttpCallResult;

const RAW_TIMEOUT_MS = 30_000;

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
 * Falsy checks use truthy-string (`!!`) so that UIs sending empty
 * strings for unfilled optional fields are treated the same as
 * omitted — this matches how NestJS DTOs serialise optional inputs.
 *
 * @param args - Method, URL, body, optional adapter/endpoint ids.
 * @param tenantId - Injected tenant for adapter resolution and `x-yoizen-tenant`.
 * @returns Normalized status, body, and string headers.
 */
export async function executeEndpointCall(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
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
    throw ApplicationFailure.create({
      message: `Circuit breaker ${decision.status} for endpoint call (${decision.reason})`,
      type: "CIRCUIT_OPEN",
      nonRetryable: false,
      nextRetryDelay: HTTP_BREAKER_COOLDOWN_MS,
      details: [{ key, status: decision.status, reason: decision.reason }],
    });
  }

  try {
    let result: IEndpointCallResult;
    if (hasAdapter && hasEndpoint) {
      result = await executeWithAdapterEndpoint(args, tenantId);
    } else if (hasAdapter) {
      result = await executeWithAdapterBase(args, tenantId);
    } else {
      result = await executeRaw(args, tenantId);
    }
    breaker.recordSuccess(key);
    return result;
  } catch (err) {
    breaker.recordFailure(key);
    throw err;
  }
}

async function executeWithAdapterEndpoint(
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
  const decision = resolveHttpResponseCachePolicy({
    enabled: workflowHttpWorkerConfig.httpResponseCacheEnabled,
    strategy: resolved.cache,
    tenantId,
    method: resolved.method,
    url,
    headers: mergedHeaders,
    body,
  });

  return httpCallWithRetry({
    url,
    method: resolved.method,
    headers: mergedHeaders,
    body,
    timeoutMs: resolved.timeoutMs,
    maxRetries: resolved.maxRetries,
    retryBackoffMs: resolved.retryBackoffMs,
    cache: {
      decision,
      store: getHttpResponseCache(),
    },
  });
}

/**
 * Adapter-with-path mode: join `adapter.baseUrl` with `args.url` and
 * use `args.method` verbatim. Adapter headers/auth/timeouts/retries
 * are honoured, so this branch behaves exactly like the endpoint
 * branch apart from URL + method coming from the action.
 *
 * `args.url` must be non-empty; we throw a non-retryable failure
 * early so the execution fails fast with a clear message rather than
 * falling through to an eventual 404.
 */
async function executeWithAdapterBase(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  if (!args.url || args.url.length === 0) {
    throw ApplicationFailure.nonRetryable(
      "endpointCall: when 'adapterId' is set without 'endpointId', 'url' must be a non-empty path (e.g. '/resource').",
      "INVALID_ENDPOINT_CALL_ARGS",
      { adapterId: args.adapterId },
    );
  }

  const client = getAdapterClient();
  const resolved = await client.resolveAdapterRequest(tenantId, args.adapterId!, {
    method: args.method,
    path: args.url,
  });

  const mergedHeaders: Record<string, string> = {
    ...resolved.headers,
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(resolved.url, args.params);
  const body = applyJsonBody(args.data, mergedHeaders);
  const decision = resolveHttpResponseCachePolicy({
    enabled: workflowHttpWorkerConfig.httpResponseCacheEnabled,
    strategy: resolved.cache,
    tenantId,
    method: resolved.method,
    url,
    headers: mergedHeaders,
    body,
  });

  return httpCallWithRetry({
    url,
    method: resolved.method,
    headers: mergedHeaders,
    body,
    timeoutMs: resolved.timeoutMs,
    maxRetries: resolved.maxRetries,
    retryBackoffMs: resolved.retryBackoffMs,
    cache: {
      decision,
      store: getHttpResponseCache(),
    },
  });
}

async function executeRaw(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  assertAbsoluteUrl(args.url);

  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(args.url, args.params);
  const body = applyJsonBody(args.data, headers);
  const decision = createBypassHttpResponseCacheDecision(
    args.method,
    HttpResponseCacheReason.UNSUPPORTED_TARGET,
  );

  const res = await cachedFetch(
    url,
    {
      method: args.method,
      headers,
      body,
      signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
    },
    {
      decision,
      cache: getHttpResponseCache(),
      fetchFn: tracedFetch,
    },
  );

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

/**
 * The raw branch calls `fetch()` directly, which requires an
 * absolute URL. When the UI sends a relative path without an
 * `adapterId`, undici throws an opaque `TypeError: fetch() URL is
 * invalid` — we catch that case up front and throw a non-retryable
 * `ApplicationFailure` with actionable context instead.
 *
 * Uses the WHATWG `URL` constructor rather than a regex: it handles
 * userinfo, IPv6, unicode hosts, etc. without us reimplementing
 * RFC 3986. O(length of url), no allocations beyond the URL object
 * that's already paid by `fetch` internally.
 */
function assertAbsoluteUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol || parsed.protocol.length === 0) {
      throw new Error("missing protocol");
    }
  } catch {
    throw ApplicationFailure.nonRetryable(
      `endpointCall: 'url' must be absolute (e.g. 'https://…') when no 'adapterId' is provided; received '${url}'.`,
      "INVALID_ENDPOINT_CALL_URL",
      { url },
    );
  }
}
