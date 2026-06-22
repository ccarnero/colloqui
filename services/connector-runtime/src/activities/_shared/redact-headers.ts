/**
 * Redacts sensitive HTTP headers before logging/publishing to observability systems.
 * Preserves header names; replaces sensitive values with [REDACTED].
 *
 * Sensitive headers include:
 * - Exact match (case-insensitive): authorization, x-api-key, x-api-secret, cookie, set-cookie
 * - Contains (case-insensitive): token, secret, key, auth
 *
 * @param headers - Original HTTP headers
 * @returns New object with sensitive values replaced
 */
export function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const EXACT_REDACT = new Set([
    "authorization",
    "x-api-key",
    "x-api-secret",
    "cookie",
    "set-cookie",
  ]);

  const CONTAINS_REDACT = ["token", "secret", "key", "auth"];
  const REDACTED = "[REDACTED]";

  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    const isSensitive =
      EXACT_REDACT.has(lowerName) ||
      CONTAINS_REDACT.some((fragment) => lowerName.includes(fragment));

    result[name] = isSensitive ? REDACTED : value;
  }

  return result;
}
