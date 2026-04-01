export type ServiceName =
  | 'api-gateway'
  | 'event-processor'
  | 'cache-service'
  | 'metrics-service';

const NAMESPACE = process.env.SMOKE_TEST_NAMESPACE ?? 'platform-services-dev';
const KOURIER_HOST = process.env.KOURIER_HOST ?? 'localhost';
const KOURIER_PORT = process.env.KOURIER_PORT ?? '8080';
const MINIKUBE_DOMAIN = process.env.MINIKUBE_DOMAIN ?? '192.168.49.2.sslip.io';

function knativeUrl(service: string): string {
  return `http://${service}.${NAMESPACE}.${MINIKUBE_DOMAIN}`;
}

const RAW_SERVICE_URLS = new Map<string, string>([
  ['api-gateway', process.env.API_GATEWAY_URL ?? knativeUrl('api-gateway')],
  ['event-processor', process.env.EVENT_PROCESSOR_URL ?? knativeUrl('event-processor')],
  ['cache-service', process.env.CACHE_SERVICE_URL ?? knativeUrl('cache-service')],
  ['metrics-service', process.env.METRICS_SERVICE_URL ?? knativeUrl('metrics-service')],
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

export async function httpGet<T = unknown>(
  url: string,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    headers: opts?.headers,
  });
  const res = await fetch(resolvedUrl, init);
  return parseResponse<T>(res);
}

export async function httpPost<T = unknown>(
  url: string,
  payload: unknown,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, opts?.headers),
    body: JSON.stringify(payload),
  });
  const res = await fetch(resolvedUrl, init);
  return parseResponse<T>(res);
}

export async function httpPut<T = unknown>(
  url: string,
  payload: unknown,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, opts?.headers),
    body: JSON.stringify(payload),
  });
  const res = await fetch(resolvedUrl, init);
  return parseResponse<T>(res);
}

export async function httpPatch<T = unknown>(
  url: string,
  payload: unknown,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    method: 'PATCH',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, opts?.headers),
    body: JSON.stringify(payload),
  });
  const res = await fetch(resolvedUrl, init);
  return parseResponse<T>(res);
}

export async function httpDelete<T = unknown>(
  url: string,
  opts?: RequestOptions,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    method: 'DELETE',
    headers: opts?.headers,
  });
  const res = await fetch(resolvedUrl, init);
  return parseResponse<T>(res);
}
