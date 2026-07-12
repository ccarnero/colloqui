// normalize-run-event-row.ts — normalizes a raw `tracking.tracked_events`
// row (as returned by the `postgres` driver for build-run-events-query.ts)
// into the `RunEventRow` shape the pure response-shaping functions expect.
// Same I/O-boundary fix as normalize-chain-event-row.ts: `timestamptz`
// columns arrive as JS `Date` objects, not strings.

import type { RunEventRow } from "./build-run-events-query.js";
import { toIsoMillis } from "./to-iso-millis.js";

/** Raw row shape as handed back by `sql.unsafe` for the run events query —
 * same as `RunEventRow` except `occurred_at` may be a driver `Date`. */
export type RawRunEventRow = Omit<RunEventRow, "occurred_at"> & {
  occurred_at: string | Date;
};

export function normalizeRunEventRow(row: RawRunEventRow): RunEventRow {
  return {
    ...row,
    occurred_at: toIsoMillis(row.occurred_at),
  };
}
