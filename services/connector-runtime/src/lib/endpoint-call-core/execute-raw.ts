import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { EndpointCallArgs } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import { getHttpResponseCache } from "../../activities/_shared/adapter-client.provider";
import { createBypassHttpResponseCacheDecision } from "../../activities/_shared/http-cache/cache-policy";
import { cachedFetch } from "../../activities/_shared/http-cache/cached-fetch";
import type { IHttpResponseCache } from "../../activities/_shared/http-cache/http-response-cache";
import {
  applyJsonBody,
  buildUrl,
} from "../../activities/_shared/http-call-with-retry";
import { HttpResponseCacheReason } from "../../activities/_shared/metrics";
import { ok, type Result } from "../result";
import { assertAbsoluteUrl } from "./assert-absolute-url";
import { classifyHttpError } from "./classify-http-error";
import type { EndpointCallError, IEndpointCallResult } from "./types";

const RAW_TIMEOUT_MS = 30_000;
const logger = new PinoLoggerService("endpoint-call-core");

/**
 * No `adapterId` → raw `fetch` against `args.url`, which MUST be absolute
 * (`http(s)://…`). Fixed 30 s timeout with no retries, same semantics as
 * pre-adapter refactor. Note: this branch does not go through the audit
 * `publishEndpointCallEvent` call — that behavior predates this extraction
 * and is preserved unchanged (the raw branch has no `adapterId` to key the
 * audit event on).
 *
 * @param httpResponseCache - Injected cache store, defaulting to the
 *   process-wide singleton (`getHttpResponseCache()`). Tests supply an
 *   isolated in-memory implementation instead of touching the singleton.
 */
export async function executeRaw(
  args: EndpointCallArgs,
  tenantId: string,
  httpResponseCache: IHttpResponseCache = getHttpResponseCache()
): Promise<Result<IEndpointCallResult, EndpointCallError>> {
  const urlCheck = assertAbsoluteUrl(args.url);
  if (!urlCheck.ok) {
    logger.warn(
      `endpointCall: raw url invalid tenant=${tenantId} url=${args.url}`
    );
    return urlCheck;
  }

  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(args.url, args.params);
  const body = applyJsonBody(args.data, headers);
  const decision = createBypassHttpResponseCacheDecision(
    args.method,
    HttpResponseCacheReason.UNSUPPORTED_TARGET
  );

  let res: Response;
  try {
    res = await cachedFetch(
      url,
      {
        method: args.method,
        headers,
        body,
        signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
      },
      {
        decision,
        cache: httpResponseCache,
        fetchFn: tracedFetch,
      }
    );
  } catch (cause) {
    logger.warn(
      `raw endpoint call failed tenant=${tenantId} url=${url}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return { ok: false, error: classifyHttpError(cause) };
  }

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

  logger.log(
    `raw endpoint call ok tenant=${tenantId} url=${url} status=${res.status}`
  );
  return ok({ status: res.status, data, headers: responseHeaders });
}
