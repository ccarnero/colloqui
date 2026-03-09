const SERVICE_URLS = new Map<string, string>([
  ['api-gateway', process.env.API_GATEWAY_URL ?? 'http://localhost:3000'],
  ['event-processor', process.env.EVENT_PROCESSOR_URL ?? 'http://localhost:3001'],
  ['cache-service', process.env.CACHE_SERVICE_URL ?? 'http://localhost:3002'],
]);

const KOURIER_HOST = process.env.KOURIER_HOST;
const KOURIER_PORT = process.env.KOURIER_PORT;

export function getBaseUrl(service: 'api-gateway' | 'event-processor' | 'cache-service'): string {
  return SERVICE_URLS.get(service)!;
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

export async function httpGet<T = unknown>(url: string): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url);
  const res = await fetch(resolvedUrl, init);
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}

export async function httpPost<T = unknown>(
  url: string,
  payload: unknown,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await fetch(resolvedUrl, init);
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}

export async function httpPut<T = unknown>(
  url: string,
  payload: unknown,
): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await fetch(resolvedUrl, init);
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}

export async function httpDelete<T = unknown>(url: string): Promise<{ status: number; body: T }> {
  const [resolvedUrl, init] = resolveRequest(url, { method: 'DELETE' });
  const res = await fetch(resolvedUrl, init);
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}
