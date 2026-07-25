// parse-node-stats-query.ts — validates + normalizes the raw
// `?correlationIds=a,b,c` query param for `GET /node-stats` (T07 of
// manual-loops/admin-console/console-redesign-builder-v2.md) into the bounded
// array `build-node-stats-query.ts` expects. Pure function, same shape as
// `parse-events-query.ts`: takes an already-extracted string (src/main.ts
// reads it off `URL#searchParams`, the only I/O edge).

import { MAX_LIST_LIMIT } from "@yoizen/shared";
import { err, ok, type Result } from "./result.js";

export interface RawNodeStatsQueryInput {
  readonly correlationIds: string | null;
}

export interface ParsedNodeStatsQuery {
  /** Deduplicated, non-empty, trimmed correlation ids — capped at
   * `MAX_LIST_LIMIT` (the same bound `clampListLimit` enforces for list
   * endpoints elsewhere in this service) so a caller cannot force an
   * unbounded `= ANY($1::text[])` scan. */
  readonly correlationIds: readonly string[];
}

/**
 * Parses+validates `?correlationIds=` — REQUIRED (an aggregate over zero
 * correlation ids is meaningless, the caller should not call this route at
 * all for a definition with no runs; workflow-service's own
 * `/workflows/:id/correlation-ids` returns an empty array in that case and
 * `WorkflowApiService` short-circuits before ever reaching this endpoint).
 * Blank entries are dropped; a comma-separated list that reduces to nothing
 * after trimming is rejected the same as a missing param.
 */
export function parseNodeStatsQuery(
  input: RawNodeStatsQueryInput
): Result<ParsedNodeStatsQuery, string> {
  const raw = input.correlationIds?.trim();
  if (!raw) {
    return err("missing required 'correlationIds' query parameter");
  }

  const seen = new Set<string>();
  for (const candidate of raw.split(",")) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      seen.add(trimmed);
    }
  }

  if (seen.size === 0) {
    return err("'correlationIds' contained no valid ids");
  }

  const correlationIds = [...seen].slice(0, MAX_LIST_LIMIT);
  return ok({ correlationIds });
}
