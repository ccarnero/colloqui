// normalize-node-stats-row.ts — defensive normalization of the raw
// `postgres` driver row for `build-node-stats-query.ts`. Same discipline as
// `normalize-run-event-row.ts`: even though the query casts `runs`/`p95_ms`/
// `ok_ratio` to numeric Postgres types the driver already parses as JS
// numbers, a malformed/NULL aggregate (e.g. every branch's `p95_ms` NULL
// because the join found zero completed pairs) must degrade to `null`
// instead of propagating `NaN` into the HTTP response.

import type { NodeStatsRow } from "./build-node-stats-query.js";

/** Raw row shape as handed back by `sql.unsafe` — same fields as
 * `NodeStatsRow` but every numeric field may arrive as a driver string
 * (defensive: some `postgres` driver configurations parse `numeric`/
 * `double precision` as strings depending on OID registration). */
export type RawNodeStatsRow = {
  action_name: string;
  branch: string | null;
  runs: number | string;
  p95_ms: number | string | null;
  ok_ratio: number | string | null;
};

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

export function normalizeNodeStatsRow(row: RawNodeStatsRow): NodeStatsRow {
  const runs = toNullableNumber(row.runs) ?? 0;
  return {
    action_name: row.action_name,
    branch: row.branch,
    runs,
    p95_ms: toNullableNumber(row.p95_ms),
    ok_ratio: toNullableNumber(row.ok_ratio),
  };
}
