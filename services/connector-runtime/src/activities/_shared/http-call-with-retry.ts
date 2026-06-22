import { tracedFetch } from "@yoizen/observability";
import { sleep } from "@yoizen/shared";
import type { IHttpResponseCachePolicyDecision } from "./http-cache/cache-policy";
import { cachedFetch } from "./http-cache/cached-fetch";
import type { IHttpResponseCache } from "./http-cache/http-response-cache";
import { toEndpointCacheResult } from "./http-cache/to-cache-result";

export type EndpointCacheResult = "hit" | "miss" | "bypass" | null;

export interface IHttpCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  cacheResult?: EndpointCacheResult; // NEW
}

export interface IHttpCallOptions {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBackoffMs: number;
  readonly cache?: {
    readonly decision: IHttpResponseCachePolicyDecision;
    readonly store: IHttpResponseCache;
  };
}

/**
 * Performs an HTTP call with exponential backoff for transient (5xx)
 * failures and network errors. `maxRetries=0` effectively disables
 * retries (one attempt). Shared across endpoint-call and service-call.
 */
export async function httpCallWithRetry(
  options: IHttpCallOptions
): Promise<IHttpCallResult> {
  const { url, method, headers, body, timeoutMs, maxRetries, retryBackoffMs } =
    options;

  let lastError: unknown;
  let cacheResult: EndpointCacheResult = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && retryBackoffMs > 0) {
      const delay = retryBackoffMs * (1 << (attempt - 1));
      await sleep(delay);
    }

    try {
      const requestInit: RequestInit = {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      };
      const res = options.cache
        ? await cachedFetch(url, requestInit, {
            decision: options.cache.decision,
            cache: options.cache.store,
            fetchFn: tracedFetch,
            onCacheResult: (r) => {
              cacheResult ??= toEndpointCacheResult(r);
            },
          })
        : await tracedFetch(url, requestInit);

      if (res.ok || attempt === maxRetries || res.status < 500) {
        return { ...(await buildResult(res)), cacheResult };
      }

      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) {
        break;
      }
    }
  }

  throw lastError;
}

export function buildUrl(
  base: string,
  params?: Record<string, unknown>
): string {
  if (!params) {
    return base;
  }
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Serializes JSON data and ensures Content-Type is set. */
export function applyJsonBody(
  data: unknown,
  headers: Record<string, string>
): string | undefined {
  if (data === undefined) {
    return undefined;
  }
  headers["Content-Type"] ??= "application/json";
  return JSON.stringify(data);
}

export async function buildResult(res: Response): Promise<IHttpCallResult> {
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
