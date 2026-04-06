import { clampListLimit, clampListOffset } from "@yoizen/shared";

/**
 * Shared pagination clamping for all audit query controllers.
 */
export function parseAuditPagination(
  limit?: number,
  offset?: number,
): { limit: number; offset: number } {
  return {
    limit: clampListLimit(limit),
    offset: clampListOffset(offset),
  };
}

export interface IAuditListResult<T> {
  events: T[];
  limit: number;
  offset: number;
}

/**
 * Standard paginated list envelope for audit query endpoints.
 */
export function toAuditListResult<T>(
  events: T[],
  limit: number,
  offset: number,
): IAuditListResult<T> {
  return { events, limit, offset };
}

/**
 * Parses pagination and fetches a page in one step (shared audit list controllers).
 */
export async function auditPaginatedQuery<TRow>(
  limitRaw: number | undefined,
  offsetRaw: number | undefined,
  fetchEvents: (limit: number, offset: number) => Promise<TRow[]>,
): Promise<IAuditListResult<TRow>> {
  const { limit, offset } = parseAuditPagination(limitRaw, offsetRaw);
  const events = await fetchEvents(limit, offset);
  return toAuditListResult(events, limit, offset);
}
