export type ServiceName =
  | 'api-gateway'
  | 'cache-service';

const NAMESPACE = process.env.SMOKE_TEST_NAMESPACE ?? 'platform-services-dev';
const KOURIER_HOST = process.env.KOURIER_HOST ?? 'localhost';
const KOURIER_PORT = process.env.KOURIER_PORT ?? '8080';
const MINIKUBE_DOMAIN = process.env.MINIKUBE_DOMAIN ?? '192.168.49.2.sslip.io';

/**
 * Default per-request budget (ms). Sized for Knative scale-from-zero on
 * minikube/orbstack — pure boot of bun + nest + a single dependency check
 * is ~12-25s; pulling images that aren't cached can push to ~45s.
 *
 * Override per request via `RequestOptions.timeoutMs` for endpoints with
 * legitimately tight SLAs (e.g. error-propagation tests).
 */
const DEFAULT_TIMEOUT_MS = Number(process.env.E2E_REQUEST_TIMEOUT_MS ?? 60_000);

/**
 * Number of *additional* attempts after the first failed attempt. So
 * `2` means up to 3 round-trips total. Retries fire only on transient
 * transport failures — see `isTransientError` / `isTransientStatus`.
 */
const DEFAULT_RETRIES = Number(process.env.E2E_REQUEST_RETRIES ?? 2);
const RETRY_INITIAL_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 2_000;

function knativeUrl(service: string): string {
  return `http://${service}.${NAMESPACE}.${MINIKUBE_DOMAIN}`;
}

// Phase 1.5: e2e suites continue to use the *logical* short name but
// resolve to the corresponding `*-api` Knative Service hostname. Worker
// pods do NOT have an HTTP route.
const RAW_SERVICE_URLS = new Map<string, string>([
  ['api-gateway', process.env.API_GATEWAY_URL ?? knativeUrl('api-gateway')],
  ['cache-service', process.env.CACHE_SERVICE_URL ?? knativeUrl('cache-service')],
]);

const API_PREFIX = '/api';

/** Returns the service URL with the `/api` prefix for api-gateway. */
export function getBaseUrl(service: ServiceName): string {
  const raw = RAW_SERVICE_URLS.get(service)!;
  return service === 'api-gateway' ? `${raw}${API_PREFIX}` : raw;
}

/** Returns the service URL without any path prefix (for /health, etc.). */
export function getRawBaseUrl(service: ServiceName): string {
  return RAW_SERVICE_URLS.get(service)!;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Per-request timeout override (ms). Falls back to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Per-request retry budget override. Falls back to `DEFAULT_RETRIES`. */
  retries?: number;
}

interface PollOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Polls `fn` with exponential backoff until it returns a truthy value or timeout.
 * O(log(timeout/initialDelay)) iterations in the best case.
 */
export async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  opts: PollOptions = {},
): Promise<T> {
  const { timeoutMs = 15_000, initialDelayMs = 100, maxDelayMs = 2_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;

  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await Bun.sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, maxDelayMs);
  }
  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

/**
 * When KOURIER_HOST is set, rewrites the URL to route through the local
 * Kourier port-forward and injects the original hostname as a Host header.
 * This lets Kourier route to the correct Knative service while the test
 * hits localhost.
 */
function resolveRequest(url: string, init?: RequestInit): [string, RequestInit] {
  if (!KOURIER_HOST || !KOURIER_PORT) return [url, init ?? {}];

  const parsed = new URL(url);
  const hostHeader = parsed.hostname;
  parsed.hostname = KOURIER_HOST;
  parsed.port = KOURIER_PORT;

  const headers = new Headers(init?.headers);
  headers.set('Host', hostHeader);

  return [parsed.toString(), { ...init, headers }];
}

function mergeHeaders(base: Record<string, string>, extra?: Record<string, string>): Record<string, string> {
  if (!extra) return base;
  return { ...base, ...extra };
}

async function parseResponse<T>(res: Response): Promise<{ status: number; body: T }> {
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}

/**
 * HTTP statuses that indicate Knative/Kourier dropped or buffered the
 * request and a retry is safe. 502/503/504 are the canonical
 * cold-start / overload signals; 408 covers proxies that surface a
 * client-side timeout. We do NOT retry 5xx app-level errors that aren't
 * gateway-shaped (e.g. 500), because those usually mean a real bug.
 */
const TRANSIENT_STATUSES = new Set<number>([408, 502, 503, 504]);

function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

/**
 * Network-level failures that warrant a retry. Bun's `fetch` surfaces
 * connection resets and DNS misses as `TypeError: fetch failed` with
 * descriptive `cause` strings. AbortError is the per-request timeout firing.
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('econnaborted') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  );
}

/**
 * Performs a single `fetch` call with a per-request `AbortSignal.timeout`.
 * Re-thrown errors and 5xx responses become retry signals upstream.
 */
async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Wraps `fetchOnce` with exponential backoff for transient transport
 * failures. Composes with the application-level `poll` helper used by the
 * tests — `poll` waits for *state* convergence, this wraps the *transport*.
 *
 * O(log(retries)) backoff growth, capped at `RETRY_MAX_DELAY_MS`.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; retries: number },
): Promise<Response> {
  const { timeoutMs, retries } = opts;
  let attempt = 0;
  let delay = RETRY_INITIAL_DELAY_MS;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const res = await fetchOnce(url, init, timeoutMs);
      if (attempt < retries && isTransientStatus(res.status)) {
        await Bun.sleep(delay);
        delay = Math.min(delay * 2, RETRY_MAX_DELAY_MS);
        attempt++;
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries && isTransientError(err)) {
        await Bun.sleep(delay);
        delay = Math.min(delay * 2, RETRY_MAX_DELAY_MS);
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('fetchWithRetry: exhausted retries');
}

async function request<T>(
  url: string,
  init: RequestInit,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, resolvedInit] = resolveRequest(url, init);
  const res = await fetchWithRetry(resolvedUrl, resolvedInit, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: opts?.retries ?? DEFAULT_RETRIES,
  });
  return parseResponse<T>(res);
}

export async function httpGet<T = unknown>(
  url: string,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  return request<T>(url, { headers: opts?.headers }, opts);
}

export async function httpPost<T = unknown>(
  url: string,
  payload: unknown,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  return request<T>(
    url,
    {
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, opts?.headers),
      body: JSON.stringify(payload),
    },
    opts,
  );
}

export async function httpPut<T = unknown>(
  url: string,
  payload: unknown,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  return request<T>(
    url,
    {
      method: 'PUT',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, opts?.headers),
      body: JSON.stringify(payload),
    },
    opts,
  );
}

export async function httpPatch<T = unknown>(
  url: string,
  payload: unknown,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  return request<T>(
    url,
    {
      method: 'PATCH',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, opts?.headers),
      body: JSON.stringify(payload),
    },
    opts,
  );
}

export async function httpDelete<T = unknown>(
  url: string,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  return request<T>(url, { method: 'DELETE', headers: opts?.headers }, opts);
}
