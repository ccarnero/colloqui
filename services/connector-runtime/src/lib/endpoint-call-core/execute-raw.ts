import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { EndpointCallArgs, EventCausalContext } from "@yoizen/shared";
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
import { redactHeaders } from "../../activities/_shared/redact-headers";
import { truncateBody } from "../../activities/_shared/truncate-body";
import { ok, type Result } from "../result";
import { assertAbsoluteUrl } from "./assert-absolute-url";
import { classifyHttpError } from "./classify-http-error";
import {
  type EndpointCallError,
  type EndpointCallEventSink,
  type IEndpointCallResult,
  noopEndpointCallEventSink,
} from "./types";

const RAW_TIMEOUT_MS = 30_000;
const logger = new PinoLoggerService("endpoint-call-core");

/**
 * No `adapterId` → raw `fetch` against `args.url`, which MUST be absolute
 * (`http(s)://…`). Fixed 30 s timeout with no retries, same semantics as
 * pre-adapter refactor.
 *
 * Publishes `connector.endpoint_call.completed.v1` on every completed call
 * (2xx and non-2xx alike, same as the adapter branches) with resource
 * `raw/<host>` (`manual-loops/connectors/connection-call-inspector.md` T02)
 * — this branch has no `adapterId` to key the default resource shape on, so
 * `evt.resource` is set explicitly (see `types.ts`'s `IEndpointCallEventPayload.resource`
 * doc). Redaction/truncation/causal-threading/fire-and-forget semantics are
 * identical to the other branches, reusing the same `publish` port.
 *
 * @param httpResponseCache - Injected cache store, defaulting to the
 *   process-wide singleton (`getHttpResponseCache()`). Tests supply an
 *   isolated in-memory implementation instead of touching the singleton.
 * @param causal - Causal context from the calling workflow's `endpointCall`
 *   action (when present), threaded into the published event so it joins
 *   the run's correlation chain instead of becoming a causal orphan.
 * @param publish - Audit-event sink injected by the entrypoint (real NATS
 *   publisher in production; defaults to a no-op so the core stays callable,
 *   and testable, without any NATS dependency).
 * @param invocationId - Set by standalone (non-workflow) callers (HTTP
 *   facade, T02) so the published audit event's envelope carries the
 *   invocation id on the payload, mirroring the adapter branches.
 */
export async function executeRaw(
  args: EndpointCallArgs,
  tenantId: string,
  httpResponseCache: IHttpResponseCache = getHttpResponseCache(),
  causal?: EventCausalContext,
  publish: EndpointCallEventSink = noopEndpointCallEventSink,
  invocationId?: string
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

  const startedAt = Date.now();
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

  publish({
    tenantId,
    adapterId: "",
    endpointId: null,
    method: args.method,
    resolvedUrl: url,
    status: res.status,
    durationMs: Date.now() - startedAt,
    cacheResult: null,
    requestHeaders: redactHeaders(headers),
    requestBody: truncateBody(body),
    responseHeaders: redactHeaders(responseHeaders),
    responseBody: truncateBody(data),
    resource: `raw/${rawResourceHost(url)}`,
    causal,
    invocationId,
  });

  logger.log(
    `raw endpoint call ok tenant=${tenantId} url=${url} status=${res.status}`
  );
  return ok({ status: res.status, data, headers: responseHeaders });
}

/**
 * Derives the envelope resource's `<host>` segment from the resolved raw URL.
 * Falls back to the full url string if URL parsing somehow fails (should not
 * happen since `assertAbsoluteUrl` already validated it) — never let resource
 * derivation break the fire-and-forget publish path.
 */
function rawResourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch (err) {
    logger.warn(
      `raw endpoint call: failed to derive host for resource from url=${url}: ${err instanceof Error ? err.message : String(err)}`
    );
    return url;
  }
}
