/** Optional list query fields shared across services (extend in service DTOs). */
export interface IPaginationQueryDto {
  readonly limit?: number;
  readonly offset?: number;
}

/** Default page size for list endpoints. */
export const DEFAULT_LIST_LIMIT = 50;

/** Maximum allowed page size for list endpoints. */
export const MAX_LIST_LIMIT = 500;

/**
 * Clamps a list `limit` query param to [1, MAX_LIST_LIMIT].
 * O(1).
 */
export function clampListLimit(
  limit: unknown,
  fallback: number = DEFAULT_LIST_LIMIT,
): number {
  const n =
    typeof limit === "number" && !Number.isNaN(limit)
      ? limit
      : Number.parseInt(String(limit ?? ""), 10);
  const v = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(v, 1), MAX_LIST_LIMIT);
}

/**
 * Clamps a list `offset` query param to >= 0.
 * O(1).
 */
export function clampListOffset(offset: unknown): number {
  const n =
    typeof offset === "number" && !Number.isNaN(offset)
      ? offset
      : Number.parseInt(String(offset ?? "0"), 10);
  return Math.max(Number.isFinite(n) ? n : 0, 0);
}
