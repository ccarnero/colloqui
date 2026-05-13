import type {
  IHttpResponseCachePolicyDecision,
} from "./cache-policy";
import type {
  ICachedHttpResponseEntry,
  IHttpResponseCache,
} from "./http-response-cache";
import {
  HttpResponseCacheReason,
  HttpResponseCacheResult,
  recordHttpResponseCache,
} from "../metrics";

export interface ICachedFetchContext {
  readonly decision: IHttpResponseCachePolicyDecision;
  readonly cache: IHttpResponseCache;
  readonly fetchFn: typeof globalThis.fetch;
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
  context: ICachedFetchContext,
): Promise<Response> {
  const { decision, cache, fetchFn } = context;
  if (!decision.policy) {
    recordHttpResponseCache(
      HttpResponseCacheResult.BYPASS,
      decision.reason,
      decision.method,
    );
    return fetchFn(input, init);
  }

  try {
    const cached = await cache.get(decision.policy.key);
    if (cached) {
      recordHttpResponseCache(
        HttpResponseCacheResult.HIT,
        HttpResponseCacheReason.OK,
        decision.method,
      );
      return rehydrateResponse(cached);
    }
  } catch {
    recordHttpResponseCache(
      HttpResponseCacheResult.BYPASS,
      HttpResponseCacheReason.REDIS_ERROR,
      decision.method,
    );
    return fetchFn(input, init);
  }

  recordHttpResponseCache(
    HttpResponseCacheResult.MISS,
    HttpResponseCacheReason.OK,
    decision.method,
  );
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
      decision.method,
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
        decision.method,
      );
    })
    .catch(() => {
      recordHttpResponseCache(
        HttpResponseCacheResult.STORE_SKIP,
        HttpResponseCacheReason.REDIS_ERROR,
        decision.method,
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
