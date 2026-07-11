// normalize-chain-event-row.ts — normalizes a raw `tracking.tracked_events`
// row as returned by the `postgres` driver into the `ChainEventRow` shape
// `toChainResponse` expects. This is the I/O-boundary fix for T02 defect 1
// (attempt 2): the `postgres` driver returns `timestamptz` columns as JS
// `Date` objects, not strings, so `occurred_at` needs normalizing to an
// ISO-8601 string with millisecond precision before it reaches the pure
// response-shaping functions.

import type { ChainEventRow } from "./build-chain-query.js";
import { toIsoMillis } from "./to-iso-millis.js";

/** Raw row shape as handed back by `sql.unsafe` for the T01 chain query —
 * same as `ChainEventRow` except `occurred_at` may be a driver `Date`. */
export type RawChainEventRow = Omit<ChainEventRow, "occurred_at"> & {
  occurred_at: string | Date;
};

export function normalizeChainEventRow(row: RawChainEventRow): ChainEventRow {
  return {
    ...row,
    occurred_at: toIsoMillis(row.occurred_at),
  };
}
