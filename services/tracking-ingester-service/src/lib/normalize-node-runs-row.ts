// normalize-node-runs-row.ts — defensive normalization of the raw
// `postgres` driver row for `build-node-runs-query.ts`. Same discipline as
// `normalize-node-stats-row.ts`: numeric/timestamp fields may arrive as
// driver strings depending on OID registration, and a run whose completion
// row lacks a paired start (should not happen given the INNER JOIN, but
// defended anyway) must degrade `duration_ms` to `null`, never `NaN`.

import type { NodeRunRow } from "./build-node-runs-query.js";

export type RawNodeRunRow = {
  correlation_id: string;
  occurred_at: string | Date;
  duration_ms: number | string | null;
  step_status: string | null;
};

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeNodeRunsRow(row: RawNodeRunRow): NodeRunRow {
  return {
    correlation_id: row.correlation_id,
    occurred_at: toIsoString(row.occurred_at),
    duration_ms: toNullableNumber(row.duration_ms),
    step_status: row.step_status,
  };
}
