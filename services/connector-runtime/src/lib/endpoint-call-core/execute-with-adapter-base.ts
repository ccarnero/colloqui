import { PinoLoggerService } from "@yoizen/observability";
import type { EndpointCallArgs, EventCausalContext } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import {
  getAdapterClient,
  getHttpResponseCache,
} from "../../activities/_shared/adapter-client.provider";
import { resolveHttpResponseCachePolicy } from "../../activities/_shared/http-cache/cache-policy";
import type { IHttpResponseCache } from "../../activities/_shared/http-cache/http-response-cache";
import {
  applyJsonBody,
  buildUrl,
  httpCallWithRetry,
} from "../../activities/_shared/http-call-with-retry";
import { redactHeaders } from "../../activities/_shared/redact-headers";
import { truncateBody } from "../../activities/_shared/truncate-body";
import { workflowHttpWorkerConfig } from "../../config";
import { err, ok, type Result } from "../result";
import { classifyHttpError } from "./classify-http-error";
import {
  type EndpointCallError,
  type EndpointCallEventSink,
  type IEndpointCallResult,
  noopEndpointCallEventSink,
} from "./types";

const logger = new PinoLoggerService("endpoint-call-core");

/**
 * Adapter-with-path mode: join `adapter.baseUrl` with `args.url` and use
 * `args.method` verbatim. Adapter headers/auth/timeouts/retries are
 * honoured, so this branch behaves exactly like the endpoint branch apart
 * from URL + method coming from the action.
 *
 * `args.url` must be non-empty; we return a non-retryable `invalid_args`
 * error early so the caller fails fast with a clear message rather than
 * falling through to an eventual 404.
 *
 * @param httpResponseCache - Injected cache store, defaulting to the
 *   process-wide singleton (`getHttpResponseCache()`). Tests supply an
 *   isolated in-memory implementation instead of touching the singleton.
 */
export async function executeWithAdapterBase(
  args: EndpointCallArgs,
  tenantId: string,
  causal?: EventCausalContext,
  publish: EndpointCallEventSink = noopEndpointCallEventSink,
  httpResponseCache: IHttpResponseCache = getHttpResponseCache()
): Promise<Result<IEndpointCallResult, EndpointCallError>> {
  if (!args.url || args.url.length === 0) {
    logger.warn(
      `endpointCall: adapterId set without endpointId and empty url, tenant=${tenantId} adapterId=${args.adapterId}`
    );
    return err({
      kind: "invalid_args",
      code: "INVALID_ENDPOINT_CALL_ARGS",
      message:
        "endpointCall: when 'adapterId' is set without 'endpointId', 'url' must be a non-empty path (e.g. '/resource').",
      details: { adapterId: args.adapterId },
    });
  }

  const client = getAdapterClient();

  let resolved: Awaited<ReturnType<typeof client.resolveAdapterRequest>>;
  try {
    resolved = await client.resolveAdapterRequest(tenantId, args.adapterId!, {
      method: args.method,
      path: args.url,
    });
  } catch (cause) {
    logger.warn(
      `adapter base resolution failed tenant=${tenantId} adapterId=${args.adapterId} path=${args.url}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return { ok: false, error: classifyHttpError(cause) };
  }

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

  const startedAt = Date.now();
  let result: IEndpointCallResult;
  try {
    result = await httpCallWithRetry({
      url,
      method: resolved.method,
      headers: mergedHeaders,
      body,
      timeoutMs: resolved.timeoutMs,
      maxRetries: resolved.maxRetries,
      retryBackoffMs: resolved.retryBackoffMs,
      cache: {
        decision,
        store: httpResponseCache,
      },
    });
  } catch (cause) {
    logger.warn(
      `endpoint call (adapter base) failed tenant=${tenantId} adapterId=${args.adapterId} url=${url}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return { ok: false, error: classifyHttpError(cause) };
  }

  publish({
    tenantId,
    adapterId: args.adapterId ?? "",
    endpointId: null,
    method: resolved.method,
    resolvedUrl: url,
    status: result.status,
    durationMs: Date.now() - startedAt,
    cacheResult: result.cacheResult ?? null,
    requestHeaders: redactHeaders(mergedHeaders),
    requestBody: truncateBody(body),
    responseHeaders: redactHeaders(result.headers),
    responseBody: truncateBody(result.data),
    cacheKey: decision.policy?.key,
    cacheTtlSeconds: decision.policy?.ttlSeconds,
    causal,
  });

  logger.log(
    `endpoint call (adapter base) ok tenant=${tenantId} adapterId=${args.adapterId} status=${result.status} cache=${result.cacheResult ?? "n/a"}`
  );
  return ok(result);
}
