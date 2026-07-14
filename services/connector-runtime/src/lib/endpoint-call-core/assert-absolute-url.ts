import { err, ok, type Result } from "../result";
import type { EndpointCallError } from "./types";

/**
 * The raw branch calls `fetch()` directly, which requires an absolute URL.
 * When the UI sends a relative path without an `adapterId`, undici throws
 * an opaque `TypeError: fetch() URL is invalid` — we catch that case up
 * front and return a non-retryable `invalid_args` error with actionable
 * context instead.
 *
 * Uses the WHATWG `URL` constructor rather than a regex: it handles
 * userinfo, IPv6, unicode hosts, etc. without us reimplementing RFC 3986.
 * O(length of url), no allocations beyond the URL object that's already
 * paid by `fetch` internally.
 */
export function assertAbsoluteUrl(
  url: string
): Result<void, EndpointCallError> {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol || parsed.protocol.length === 0) {
      throw new Error("missing protocol");
    }
    return ok(undefined);
  } catch {
    return err({
      kind: "invalid_args",
      code: "INVALID_ENDPOINT_CALL_URL",
      message: `endpointCall: 'url' must be absolute (e.g. 'https://…') when no 'adapterId' is provided; received '${url}'.`,
      details: { url },
    });
  }
}
