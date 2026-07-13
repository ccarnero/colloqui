// parse-events-query.ts — validates + normalizes the raw `?type=&resource=
// &from=&limit=` query params for `GET /events` (T03 of
// manual-loops/connector-trace-linking.md) into the shape
// `build-events-query.ts` expects. Pure function: takes already-extracted
// string values (src/main.ts reads them off `URL#searchParams`, the only I/O
// edge), never touches a `URL`/`Request` object itself.

import { clampListLimit } from "@yoizen/shared";
import { err, ok, type Result } from "./result.js";

export interface RawEventsQueryInput {
  readonly type: string | null;
  readonly resource: string | null;
  readonly from: string | null;
  readonly limit: string | null;
}

export interface ParsedEventsQuery {
  readonly type: string;
  readonly resource: string | null;
  readonly from: string | null;
  /** Clamped to `[1, MAX_LIST_LIMIT]` via `clampListLimit` (`@yoizen/shared`) —
   * same shared pagination helper `audit-service` uses, so the default (50)
   * and hard cap (500) stay consistent across every list endpoint in the
   * platform instead of inventing a third value here. */
  readonly limit: number;
}

/**
 * Parses+validates the raw `GET /events` query params.
 *
 * `type` is REQUIRED — without it the query would be an unbounded scan of
 * every event this tenant has ever emitted (no other filter is guaranteed to
 * narrow it, `resource`/`from` are optional). `from`, when present, MUST be a
 * parseable date; `resource`/`from` blank strings normalize to `null`, not an
 * empty-string filter that would never match anything.
 */
export function parseEventsQuery(
  input: RawEventsQueryInput
): Result<ParsedEventsQuery, string> {
  const type = input.type?.trim();
  if (!type) {
    return err("missing required 'type' query parameter");
  }

  const resource = input.resource?.trim();
  const from = input.from?.trim();

  if (from && Number.isNaN(Date.parse(from))) {
    return err("invalid 'from' query parameter (must be a parseable date)");
  }

  return ok({
    type,
    resource: resource ? resource : null,
    from: from ? from : null,
    limit: clampListLimit(input.limit ?? undefined),
  });
}
