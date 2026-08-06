// `AdapterCache` implementation backed by cache-service's HTTP API
// (SPEC PENDIENTES/01-bugs-group-b, T11/E36b).
//
// The HTTP-response cache (`createHttpResponseCache`) used to talk to Redis
// directly through the same ioredis client every other Redis user in this
// service shares. That made connector-runtime a second, uncoordinated owner
// of a cache namespace that cache-service already owns (L1 + L2, TTL
// semantics, tenant scoping, key SCAN for operators). Routing the
// HTTP-response cache through cache-service gives that namespace ONE owner
// and makes the cached keys visible/purgeable through cache-service's API.
// Every OTHER Redis use in this service (adapter-config SWR mirror, circuit
// breaker, rate limits, invocation store) intentionally stays on raw Redis.
//
// Contract mapping (`services/cache-service/src/modules/cache/cache.controller.ts`):
//   get(key)               -> GET  /cache/:key
//                             ALWAYS 200 + `application/json`; a miss is the
//                             JSON literal `null` (fixed in T10 — strings used
//                             to come back as unquoted text/plain).
//   setex(key, ttl, value) -> PUT  /cache/:key  {"value":<v>,"ttl":<seconds>}
//                             (TTL rides the body; there is no TTL query param)
//   del(...keys)           -> DELETE /cache/:key, one request per key
//
// Keys are `encodeURIComponent`-ed into the path: they are opaque
// (`httpcache:v1:<sha256>`) and Fastify decodes route params, so the logical
// key stored in Redis is byte-identical to the one this service computes.
// No `x-yoizen-tenant` header is sent on purpose: the HTTP-response cache key
// ALREADY hashes the tenant id (`resolveHttpResponseCachePolicy`), so adding
// cache-service's tenant prefix would double-scope the key and silently
// invalidate every key written before this change.
//
// RESILIENCE MANDATE: a connector call must NEVER fail because the cache is
// down. Every failure mode (timeout, 5xx, connection refused, non-JSON body)
// is logged at warn and degrades to a cache MISS on `get` / a NO-OP on
// `setex` / `del`. Nothing here ever throws.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { AdapterCache } from "@yoizen/shared";

const logger = new PinoLoggerService("connector-runtime-cache-service-store");

/**
 * How often a repeated failure with the same (scope, message) is logged.
 * Same de-dup rationale as `adapter-client.provider.ts`'s `logCacheError`:
 * a sustained cache-service outage would otherwise emit one warn per
 * connector call and flood the log pipeline.
 */
const CACHE_ERROR_LOG_EVERY = 50;

export interface ICacheServiceStoreOptions {
  /** Base URL of cache-service, e.g. `http://cache-service.<ns>.svc.cluster.local`. */
  readonly baseUrl: string;
  /**
   * Per-request timeout. Bounded on purpose and small by default: the caller
   * is on the critical path of an outbound connector call, so a wedged
   * cache-service must cost at most this much before we fall through to the
   * real upstream. Mirrors `httpCallWithRetry`'s `AbortSignal.timeout` shape.
   */
  readonly timeoutMs: number;
  /** Injectable for tests; defaults to the traced fetch every outbound call here uses. */
  readonly fetchFn?: typeof fetch;
}

/**
 * Builds an `AdapterCache` whose backing store is cache-service over HTTP.
 *
 * @param options - Base URL, bounded timeout, optional fetch override.
 * @returns A never-throwing cache facade (`get` / `setex` / `del`).
 */
export function createCacheServiceAdapterCache(
  options: ICacheServiceStoreOptions
): AdapterCache {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? tracedFetch;
  const errorCounts = new Map<string, number>();

  logger.log(
    `http-response cache store bound to cache-service at ${baseUrl} (timeout=${options.timeoutMs}ms)`
  );

  function logStoreError(scope: string, key: string, message: string): void {
    const dedupKey = `${scope}:${message}`;
    const count = (errorCounts.get(dedupKey) ?? 0) + 1;
    errorCounts.set(dedupKey, count);
    if (count === 1 || count % CACHE_ERROR_LOG_EVERY === 0) {
      logger.warn(
        `cache-service ${scope} failed (repeat=${count}) key=${key} url=${baseUrl}: ${message} — treating as cache miss/no-op`
      );
    }
  }

  function keyUrl(key: string): string {
    return `${baseUrl}/cache/${encodeURIComponent(key)}`;
  }

  function toMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  return {
    async get(key: string): Promise<string | null> {
      try {
        const response = await fetchFn(keyUrl(key), {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(options.timeoutMs),
        });

        if (!response.ok) {
          logStoreError("get", key, `HTTP ${response.status}`);
          return null;
        }

        const parsed = (await response.json()) as unknown;
        if (parsed === null || parsed === undefined) {
          logger.debug(`cache-service get miss key=${key}`);
          return null;
        }
        if (typeof parsed === "string") {
          logger.debug(`cache-service get hit key=${key}`);
          return parsed;
        }
        // Some other writer stored a non-string value under this key.
        // `AdapterCache` is string-typed and every consumer JSON.parses the
        // result, so re-serializing keeps the round trip lossless.
        logger.debug(
          `cache-service get hit key=${key} (non-string value re-serialized)`
        );
        return JSON.stringify(parsed);
      } catch (cause) {
        logStoreError("get", key, toMessage(cause));
        return null;
      }
    },

    async setex(key: string, seconds: number, value: string): Promise<unknown> {
      // cache-service validates `ttl` as an integer >= 1 (SetCacheDto); a
      // sub-second/fractional TTL would be rejected with a 400.
      const ttl = Math.max(1, Math.trunc(seconds));
      try {
        const response = await fetchFn(keyUrl(key), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value, ttl }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });

        if (!response.ok) {
          logStoreError("setex", key, `HTTP ${response.status}`);
          return null;
        }
        logger.debug(`cache-service setex ok key=${key} ttl=${ttl}s`);
        return "OK";
      } catch (cause) {
        logStoreError("setex", key, toMessage(cause));
        return null;
      }
    },

    async del(...keys: string[]): Promise<unknown> {
      let deleted = 0;
      for (const key of keys) {
        try {
          const response = await fetchFn(keyUrl(key), {
            method: "DELETE",
            signal: AbortSignal.timeout(options.timeoutMs),
          });
          if (!response.ok) {
            logStoreError("del", key, `HTTP ${response.status}`);
            continue;
          }
          deleted += 1;
          logger.debug(`cache-service del ok key=${key}`);
        } catch (cause) {
          logStoreError("del", key, toMessage(cause));
        }
      }
      return deleted;
    },
  };
}
