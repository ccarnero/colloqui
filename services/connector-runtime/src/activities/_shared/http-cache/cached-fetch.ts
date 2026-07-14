import {
  HttpResponseCacheReason,
  HttpResponseCacheResult,
  type HttpResponseCacheResultValue,
  recordHttpResponseCache,
} from "../metrics";
import type { IHttpResponseCachePolicyDecision } from "./cache-policy";
import type {
  ICachedHttpResponseEntry,
  IHttpResponseCache,
} from "./http-response-cache";

/**
 * Structural fetch signature rather than `typeof globalThis.fetch`: callers
 * pass wrapped fetch implementations (e.g. `tracedFetch` from
 * `@yoizen/observability`) that do not carry `fetch`'s static members
 * (`preconnect`), so the narrower type accepts any function matching the
 * call shape.
 */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ICachedFetchContext {
  readonly decision: IHttpResponseCachePolicyDecision;
  readonly cache: IHttpResponseCache;
  readonly fetchFn: FetchLike;
  readonly onCacheResult?: (result: HttpResponseCacheResultValue) => void;
}

/**
 * Wraps `fetch` with a Redis-backed response cache.
 *
 * When the resolved policy is null the wrapper behaves as a transparent
 * passthrough. Otherwise it rehydrates fresh entries from Redis and stores
 * successful responses after buffering the body once.
 */
export async function cachedFetch(
  input: string,
  init: RequestInit,
  context: ICachedFetchContext
): Promise<Response> {
  const { decision, cache, fetchFn, onCacheResult } = context;
  if (!decision.policy) {
    recordHttpResponseCache(
      HttpResponseCacheResult.BYPASS,
      decision.reason,
      decision.method
    );
    onCacheResult?.(HttpResponseCacheResult.BYPASS);
    return fetchFn(input, init);
  }

  try {
    const cached = await cache.get(decision.policy.key);
    if (cached) {
      recordHttpResponseCache(
        HttpResponseCacheResult.HIT,
        HttpResponseCacheReason.OK,
        decision.method
      );
      onCacheResult?.(HttpResponseCacheResult.HIT);
      return rehydrateResponse(cached);
    }
  } catch {
    recordHttpResponseCache(
      HttpResponseCacheResult.BYPASS,
      HttpResponseCacheReason.REDIS_ERROR,
      decision.method
    );
    onCacheResult?.(HttpResponseCacheResult.BYPASS);
    return fetchFn(input, init);
  }

  recordHttpResponseCache(
    HttpResponseCacheResult.MISS,
    HttpResponseCacheReason.OK,
    decision.method
  );
  onCacheResult?.(HttpResponseCacheResult.MISS);
  const response = await fetchFn(input, init);
  const bodyBuffer = await response.arrayBuffer();
  const nextResponse = new Response(bodyBuffer.slice(0), {
    status: response.status,
    headers: cloneHeaders(response.headers),
  });

  if (!response.ok) {
    recordHttpResponseCache(
      HttpResponseCacheResult.STORE_SKIP,
      HttpResponseCacheReason.STATUS,
      decision.method
    );
    return nextResponse;
  }

  const entry: ICachedHttpResponseEntry = {
    status: response.status,
    bodyBase64: Buffer.from(bodyBuffer).toString("base64"),
    headers: cloneHeaders(response.headers),
    storedAtMs: Date.now(),
  };

  void cache
    .setex(decision.policy.key, decision.policy.ttlSeconds, entry)
    .then(() => {
      recordHttpResponseCache(
        HttpResponseCacheResult.STORE,
        HttpResponseCacheReason.OK,
        decision.method
      );
    })
    .catch(() => {
      recordHttpResponseCache(
        HttpResponseCacheResult.STORE_SKIP,
        HttpResponseCacheReason.REDIS_ERROR,
        decision.method
      );
    });
  return nextResponse;
}

function rehydrateResponse(entry: ICachedHttpResponseEntry): Response {
  return new Response(Buffer.from(entry.bodyBase64, "base64"), {
    status: entry.status,
    headers: entry.headers,
  });
}

function cloneHeaders(headers: Headers): Record<string, string> {
  const nextHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    nextHeaders[key] = value;
  });
  return nextHeaders;
}
