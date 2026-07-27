// to-node-runs-response.ts — shapes the rows returned by
// `build-node-runs-query.ts` into the `GET /node-runs` response body
// (IF-editor round-2 task). Pure function, no I/O — same shape as
// `to-node-stats-response.ts`.

import type { NodeRunRow } from "./build-node-runs-query.js";

export interface NodeRunsResponse {
  readonly tenant: string;
  readonly actionName: string;
  readonly correlationIdCount: number;
  readonly rowCount: number;
  readonly rows: readonly NodeRunRow[];
}

export function toNodeRunsResponse(
  tenant: string,
  actionName: string,
  correlationIdCount: number,
  rows: readonly NodeRunRow[]
): NodeRunsResponse {
  return {
    tenant,
    actionName,
    correlationIdCount,
    rowCount: rows.length,
    rows,
  };
}
