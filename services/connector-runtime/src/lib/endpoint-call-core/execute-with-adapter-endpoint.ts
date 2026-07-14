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
import { ok, type Result } from "../result";
import { classifyHttpError } from "./classify-http-error";
import {
  type EndpointCallError,
  type EndpointCallEventSink,
  type IEndpointCallResult,
  noopEndpointCallEventSink,
} from "./types";

const logger = new PinoLoggerService("endpoint-call-core");

/**
 * Fully-resolved mode: `adapterId` + `endpointId` — method/path/headers/
 * timeouts all come from the adapter's endpoint definition; `args.url` is
 * ignored. Mirrors the original `endpoint-call.activity.ts` branch, moved
 * here per `manual-loops/connector-invoke-api.md` T01 so both the Temporal
 * activity and the future sync/async HTTP flavors share the same governed
 * (breaker/cache/audit) execution path.
 *
 * @param httpResponseCache - Injected cache store, defaulting to the
 *   process-wide singleton (`getHttpResponseCache()`). Tests supply an
 *   isolated in-memory implementation instead of touching the singleton.
 */
export async function executeWithAdapterEndpoint(
  args: EndpointCallArgs,
  tenantId: string,
  causal?: EventCausalContext,
  publish: EndpointCallEventSink = noopEndpointCallEventSink,
  httpResponseCache: IHttpResponseCache = getHttpResponseCache()
): Promise<Result<IEndpointCallResult, EndpointCallError>> {
  const client = getAdapterClient();

  let resolved: Awaited<ReturnType<typeof client.resolveRequest>>;
  try {
    resolved = await client.resolveRequest(
      tenantId,
      args.adapterId!,
      args.endpointId!
    );
  } catch (cause) {
    logger.warn(
      `adapter endpoint resolution failed tenant=${tenantId} adapterId=${args.adapterId} endpointId=${args.endpointId}: ${cause instanceof Error ? cause.message : String(cause)}`
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
      `endpoint call failed tenant=${tenantId} adapterId=${args.adapterId} endpointId=${args.endpointId} url=${url}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return { ok: false, error: classifyHttpError(cause) };
  }

  publish({
    tenantId,
    adapterId: args.adapterId ?? "",
    endpointId: args.endpointId ?? null,
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
    `endpoint call ok tenant=${tenantId} adapterId=${args.adapterId} endpointId=${args.endpointId} status=${result.status} cache=${result.cacheResult ?? "n/a"}`
  );
  return ok(result);
}
