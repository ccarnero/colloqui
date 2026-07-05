import { SdkError } from "../domain/errors.js";

/**
 * Minimal shape actually used from a fetch Response. Deliberately narrower than
 * `typeof fetch` / `Response` so tests can pass lightweight fakes (as the original
 * JS did) without satisfying the full DOM `Response` interface.
 */
export interface FetchResponseLike {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  /**
   * Optional: real `fetch` Responses always have this. Test fakes may omit it —
   * callers that need a header (e.g. `Retry-After`) get `undefined` instead of a throw.
   */
  headers?: { get(name: string): string | null };
  /**
   * Optional: real `fetch` Responses always have this. Only read by
   * `Transport.requestStream()` (see `core/transport.ts`) — `request()`/`httpJson`
   * never touch it. Test fakes for JSON-only flows can omit it.
   */
  body?: ReadableStream<Uint8Array> | null;
}

/** Minimal shape actually used from a fetch implementation (see {@link FetchResponseLike}). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export interface HttpJsonRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpJsonResult {
  status: number;
  ok: boolean;
  body: unknown;
  /** `Retry-After` response header, normalized to milliseconds (seconds or HTTP-date form). */
  retryAfterMs?: number;
}

/** Parses a `Retry-After` header value (delay-seconds or HTTP-date) into milliseconds. */
function parseRetryAfterMs(
  value: string | null | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, dateMs - Date.now());
}

/**
 * Minimal JSON HTTP helper over `fetch`. Returns `{ status, ok, body }` and does NOT
 * throw on non-2xx — adapters decide how each status maps to a domain error. Throws
 * `SdkError` (code "NETWORK") only on transport/timeout failures.
 */
export async function httpJson(
  fetchImpl: FetchLike,
  {
    url,
    method = "GET",
    headers = {},
    body,
    timeoutMs = 10_000,
  }: HttpJsonRequest
): Promise<HttpJsonResult> {
  const finalHeaders: Record<string, string> = { ...headers };
  let payload: string | undefined;
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: FetchResponseLike;
  try {
    res = await fetchImpl(url, {
      method,
      headers: finalHeaders,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SdkError(`network error calling ${method} ${url}`, {
      code: "NETWORK",
      cause: err,
    });
  }

  const text = await res.text().catch(() => "");
  let parsed: unknown;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  const retryAfterMs = parseRetryAfterMs(res.headers?.get("retry-after"));

  return { status: res.status, ok: res.ok, body: parsed, retryAfterMs };
}
