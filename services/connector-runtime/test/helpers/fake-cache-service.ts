// In-memory stand-in for cache-service's HTTP API, used by the shared
// `"@yoizen/observability"` double (`fake-traced-fetch.ts`) to serve the
// HTTP-response cache's traffic without a network.
//
// WHY THIS EXISTS: since T11/E36b the HTTP-response cache
// (`getHttpResponseCache()`) is backed by cache-service over HTTP instead of
// raw Redis. Every spec that exercises an endpoint/service call through the
// process-wide singleton therefore emits `GET`/`PUT /cache/:key` requests on
// the SAME `tracedFetch` edge those specs use to assert upstream calls. Left
// unhandled, that would (a) inflate their `tracedFetch` call counts and (b)
// turn their generic "200 + {...}" responder into a bogus cache HIT for every
// key. `fake-traced-fetch.ts` intercepts cache-service URLs here FIRST and
// only delegates non-cache traffic to the spec's own fake — the exact role
// `fake-adapter-redis.ts` used to play for these keys.
//
// The store is process-wide and stateful (like the real cache) so a
// miss-then-hit cycle works; call `resetFakeCacheService()` in `beforeEach`.
// TTLs are recorded but never expire: no spec asserts wall-clock expiry, and
// timers in a shared double would make other files flaky.

const CACHE_PATH_PREFIX = "/cache/";

export interface IFakeCacheServiceRequest {
  readonly method: string;
  /** Logical (decoded) key. */
  readonly key: string;
  /** TTL seconds sent in the PUT body, when present. */
  readonly ttl?: number;
  /** Value sent in the PUT body, when present. */
  readonly value?: unknown;
}

const store = new Map<string, unknown>();
const requests: IFakeCacheServiceRequest[] = [];

/** Clears both the stored values and the recorded request log. */
export function resetFakeCacheService(): void {
  store.clear();
  requests.length = 0;
}

/** Every cache-service request served since the last reset, in order. */
export function getFakeCacheServiceRequests(): readonly IFakeCacheServiceRequest[] {
  return requests;
}

/** Raw stored value for a logical key (`undefined` when absent). */
export function getFakeCacheServiceValue(key: string): unknown {
  return store.get(key);
}

function toUrl(input: string | URL | Request): URL | null {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Serves a cache-service request from the in-memory store.
 *
 * @param input - Request URL (string/URL/Request), as handed to `tracedFetch`.
 * @param init - Fetch init (method + JSON body for PUT).
 * @returns A cache-service-shaped `Response`, or `null` when the URL does not
 *   target cache-service (the caller must then delegate to its own fake).
 */
export function handleFakeCacheServiceRequest(
  input: string | URL | Request,
  init?: RequestInit
): Response | null {
  const url = toUrl(input);
  if (
    !url?.hostname.startsWith("cache-service") ||
    !url.pathname.startsWith(CACHE_PATH_PREFIX)
  ) {
    return null;
  }

  const key = decodeURIComponent(url.pathname.slice(CACHE_PATH_PREFIX.length));
  const method = (init?.method ?? "GET").toUpperCase();
  const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

  if (method === "PUT") {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      value?: unknown;
      ttl?: number;
    };
    store.set(key, body.value);
    requests.push({ method, key, ttl: body.ttl, value: body.value });
    return new Response('{"ok":true}', { status: 200, headers: jsonHeaders });
  }

  if (method === "DELETE") {
    store.delete(key);
    requests.push({ method, key });
    return new Response('{"ok":true}', { status: 200, headers: jsonHeaders });
  }

  requests.push({ method, key });
  // Contract (T10): always 200 + application/json; a miss is the literal `null`.
  return new Response(JSON.stringify(store.get(key) ?? null), {
    status: 200,
    headers: jsonHeaders,
  });
}
