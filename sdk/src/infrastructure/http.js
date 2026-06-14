import { SdkError } from "../domain/errors.js";

/**
 * Minimal JSON HTTP helper over `fetch`. Returns `{ status, ok, body }` and does NOT
 * throw on non-2xx — adapters decide how each status maps to a domain error. Throws
 * `SdkError` (code "NETWORK") only on transport/timeout failures.
 *
 * @param {typeof fetch} fetchImpl
 * @param {{ url: string, method?: string, headers?: Record<string,string>, body?: unknown, timeoutMs?: number }} req
 * @returns {Promise<{ status: number, ok: boolean, body: unknown }>}
 */
export async function httpJson(
  fetchImpl,
  { url, method = "GET", headers = {}, body, timeoutMs = 10_000 },
) {
  const finalHeaders = { ...headers };
  let payload;
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
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
  let parsed;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return { status: res.status, ok: res.ok, body: parsed };
}
