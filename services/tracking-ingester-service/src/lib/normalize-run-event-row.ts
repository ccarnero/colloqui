// normalize-run-event-row.ts — normalizes a raw `tracking.tracked_events`
// row (as returned by the `postgres` driver for build-run-events-query.ts)
// into the `RunEventRow` shape the pure response-shaping functions expect.
// Same I/O-boundary fix as normalize-chain-event-row.ts: `timestamptz`
// columns arrive as JS `Date` objects, not strings. T03 of
// manual-loops/run-view.md additionally normalizes `payload_action_index`
// (numeric text -> `number | null`, same treatment `normalize-chain-span-row.ts`
// gives `duration_ms`) — `payload_cases` needs no normalization, since
// `->'cases'` (jsonb, not text) already arrives pre-parsed as a JS array.

import type { RunEventRow } from "./build-run-events-query.js";
import { toIsoMillis } from "./to-iso-millis.js";

/** Raw row shape as handed back by `sql.unsafe` for the run events query —
 * same as `RunEventRow` except `occurred_at` may be a driver `Date` and
 * `payload_action_index` arrives as the numeric TEXT `->>'actionIndex'`
 * extracts (or `null`). */
export type RawRunEventRow = Omit<
  RunEventRow,
  "occurred_at" | "payload_action_index"
> & {
  occurred_at: string | Date;
  payload_action_index: string | null;
};

export function normalizeRunEventRow(row: RawRunEventRow): RunEventRow {
  const parsedActionIndex =
    row.payload_action_index === null ? null : Number(row.payload_action_index);

  return {
    ...row,
    occurred_at: toIsoMillis(row.occurred_at),
    // Guards against a malformed/non-numeric jsonb value degrading the
    // whole run response instead of just this one field.
    payload_action_index:
      parsedActionIndex === null || Number.isNaN(parsedActionIndex)
        ? null
        : parsedActionIndex,
  };
}
