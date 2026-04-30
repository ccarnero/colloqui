/**
 * Maps numeric pagination fields to downstream query string values (O(1)).
 */
export function toOptionalStringQueryParam(
  value: number | undefined,
): string | undefined {
  return value !== undefined ? String(value) : undefined;
}
