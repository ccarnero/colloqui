// handle-node-runs-request.ts — orchestrates the
// `GET /node-runs?correlationIds=a,b,c&actionName=...` request (IF-editor
// round-2 task, builder inspector Runs tab): tenant guard, query-param
// validation (`parseNodeRunsQuery`), the ungrouped runs-list query
// (`buildNodeRunsQuery`), and shaping via `toNodeRunsResponse` — WITHOUT
// touching a concrete Postgres client. Same injected-I/O shape as
// `handle-node-stats-request.ts`: the actual `sql.unsafe(...)` round trip
// is bound in `src/main.ts` (the only I/O edge).

import type { NodeRunRow } from "./build-node-runs-query.js";
import {
  buildNodeRunsQuery,
  type NodeRunsQuery,
} from "./build-node-runs-query.js";
import {
  parseNodeRunsQuery,
  type RawNodeRunsQueryInput,
} from "./parse-node-runs-query.js";
import {
  type NodeRunsResponse,
  toNodeRunsResponse,
} from "./to-node-runs-response.js";

export interface NodeRunsRequestDeps {
  /** Executes the ungrouped runs-list query — normally
   * `sql.unsafe(query.text, query.params).then((rows) => rows.map(normalizeNodeRunsRow))`. */
  readonly queryNodeRuns: (
    query: NodeRunsQuery
  ) => Promise<readonly NodeRunRow[]>;
  /** Optional line logger for verbose query-path logging. */
  readonly log?: (message: string) => void;
}

export type NodeRunsRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | { readonly status: 200; readonly body: NodeRunsResponse };

/**
 * Handles a per-node recent-runs list read: 400 when `tenant` is missing
 * (the gateway proxy always sets `x-yoizen-tenant`), 400 when
 * `correlationIds`/`actionName` fails validation, otherwise 200 with the
 * shaped `NodeRunsResponse` — 200 with an empty `rows` array when the node
 * has no completed runs yet in the given correlation set (legitimate empty
 * case, never a 404, same discipline as `handleNodeStatsRequest`).
 */
export async function handleNodeRunsRequest(
  tenant: string | null,
  rawQuery: RawNodeRunsQueryInput,
  deps: NodeRunsRequestDeps
): Promise<NodeRunsRequestResult> {
  const log = deps.log ?? ((): void => {});

  if (tenant === null || tenant.trim().length === 0) {
    log("handleNodeRunsRequest: REJECTED — missing x-yoizen-tenant header");
    return {
      status: 400,
      body: { error: "missing x-yoizen-tenant header" },
    };
  }

  const parsed = parseNodeRunsQuery(rawQuery);
  if (!parsed.ok) {
    log(`handleNodeRunsRequest: REJECTED tenant=${tenant} — ${parsed.error}`);
    return {
      status: 400,
      body: { error: parsed.error },
    };
  }

  const { correlationIds, actionName } = parsed.value;
  log(
    `handleNodeRunsRequest: querying tenant=${tenant} actionName=${actionName} correlation_id_count=${correlationIds.length}`
  );

  const query = buildNodeRunsQuery(correlationIds, tenant, actionName);
  const rows = await deps.queryNodeRuns(query);

  log(
    `handleNodeRunsRequest: OK tenant=${tenant} actionName=${actionName} correlation_id_count=${correlationIds.length} row_count=${rows.length}`
  );

  const response = toNodeRunsResponse(
    tenant,
    actionName,
    correlationIds.length,
    rows
  );
  return { status: 200, body: response };
}
