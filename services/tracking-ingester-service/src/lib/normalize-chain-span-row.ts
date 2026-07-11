// normalize-chain-span-row.ts — normalizes a raw `tracking.tracked_event_spans`
// row as returned by the `postgres` driver into the `ChainSpanRow` shape
// `toChainResponse` expects. This is the I/O-boundary fix for T02 defects 1
// and 2 (attempt 2): `start_time`/`end_time` (`timestamptz`) arrive as JS
// `Date` objects, and `duration_ms` (Postgres numeric/bigint) arrives as a
// string — both need normalizing before they reach the pure
// response-shaping functions / the T05 waterfall consumer.

import type { ChainSpanRow } from "./build-spans-query.js";
import { toIsoMillis } from "./to-iso-millis.js";

/** Raw row shape as handed back by `sql.unsafe` for the T01 spans query —
 * same as `ChainSpanRow` except timestamps may be driver `Date`s and
 * `duration_ms` may be a numeric/bigint string. */
export type RawChainSpanRow = Omit<
  ChainSpanRow,
  "started_at" | "completed_at" | "duration_ms"
> & {
  started_at: string | Date;
  completed_at: string | Date;
  duration_ms: string | number;
};

export function normalizeChainSpanRow(row: RawChainSpanRow): ChainSpanRow {
  return {
    ...row,
    started_at: toIsoMillis(row.started_at),
    completed_at: toIsoMillis(row.completed_at),
    duration_ms: Number(row.duration_ms),
  };
}
