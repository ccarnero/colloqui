/**
 * Serializes and truncates HTTP body to a safe size for logging/publishing.
 * Prevents audit log bloat from large payloads.
 *
 * - Returns undefined for null/undefined input
 * - Stringifies objects with JSON.stringify
 * - Passes through string input as-is
 * - Truncates to 8192 characters if longer
 *
 * Note: Truncated JSON may not be valid — consumers must handle gracefully.
 *
 * @param body - Request or response body (may be object, string, or null)
 * @returns Serialized string (up to 8192 chars) or undefined
 */
export function truncateBody(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  const MAX_BODY_BYTES = 8192;
  const raw = typeof body === "string" ? body : JSON.stringify(body);

  return raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;
}
