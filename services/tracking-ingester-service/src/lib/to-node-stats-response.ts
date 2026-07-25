// to-node-stats-response.ts — shapes the aggregated rows returned by
// `build-node-stats-query.ts` into the `GET /node-stats` response body
// (T07 of manual-loops/admin-console/console-redesign-builder-v2.md). Pure
// function, no I/O — same shape as `to-events-response.ts`.

import type { NodeStatsRow } from "./build-node-stats-query.js";

export interface NodeStatsResponse {
  readonly tenant: string;
  readonly correlationIdCount: number;
  readonly rowCount: number;
  readonly rows: readonly NodeStatsRow[];
}

export function toNodeStatsResponse(
  tenant: string,
  correlationIdCount: number,
  rows: readonly NodeStatsRow[]
): NodeStatsResponse {
  return {
    tenant,
    correlationIdCount,
    rowCount: rows.length,
    rows,
  };
}
