// Orchestrates the `GET /node-stats?correlationIds=a,b,c` request (T07 of
// manual-loops/admin-console/console-redesign-builder-v2.md — the option-(b)
// aggregate the "T06 findings" section of that SPEC recommends): tenant
// guard, query-param validation (`parseNodeStatsQuery`), the grouped
// aggregate query (`buildNodeStatsQuery`), and shaping via
// `toNodeStatsResponse` — WITHOUT touching a concrete Postgres client. Same
// injected-I/O shape as `handle-events-request.ts`/`handle-run-request.ts`:
// the actual `sql.unsafe(...)` round trip is bound in `src/main.ts` (the
// only I/O edge).

import type { NodeStatsRow } from "./build-node-stats-query.js";
import {
  buildNodeStatsQuery,
  type NodeStatsQuery,
} from "./build-node-stats-query.js";
import {
  parseNodeStatsQuery,
  type RawNodeStatsQueryInput,
} from "./parse-node-stats-query.js";
import {
  type NodeStatsResponse,
  toNodeStatsResponse,
} from "./to-node-stats-response.js";

export interface NodeStatsRequestDeps {
  /** Executes the grouped aggregate query — normally
   * `sql.unsafe(query.text, query.params).then((rows) => rows.map(normalizeNodeStatsRow))`. */
  readonly queryNodeStats: (
    query: NodeStatsQuery
  ) => Promise<readonly NodeStatsRow[]>;
  /** Optional line logger for verbose query-path logging. */
  readonly log?: (message: string) => void;
}

export type NodeStatsRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | { readonly status: 200; readonly body: NodeStatsResponse };

/**
 * Handles a per-node stats aggregate read: 400 when `tenant` is missing
 * (the gateway proxy always sets `x-yoizen-tenant`), 400 when
 * `correlationIds` fails validation, otherwise 200 with the shaped
 * `NodeStatsResponse` — 200 with an empty `rows` array when the given
 * correlation ids have no `action_started`/`action_completed` pairs yet
 * (the legitimate "definition with no completed runs" empty case the SPEC's
 * T06 findings call out — never a 404, this is an aggregate, not a
 * single-resource lookup).
 */
export async function handleNodeStatsRequest(
  tenant: string | null,
  rawQuery: RawNodeStatsQueryInput,
  deps: NodeStatsRequestDeps
): Promise<NodeStatsRequestResult> {
  const log = deps.log ?? ((): void => {});

  if (tenant === null || tenant.trim().length === 0) {
    log("handleNodeStatsRequest: REJECTED — missing x-yoizen-tenant header");
    return {
      status: 400,
      body: { error: "missing x-yoizen-tenant header" },
    };
  }

  const parsed = parseNodeStatsQuery(rawQuery);
  if (!parsed.ok) {
    log(`handleNodeStatsRequest: REJECTED tenant=${tenant} — ${parsed.error}`);
    return {
      status: 400,
      body: { error: parsed.error },
    };
  }

  const { correlationIds } = parsed.value;
  log(
    `handleNodeStatsRequest: aggregating tenant=${tenant} correlation_id_count=${correlationIds.length}`
  );

  const query = buildNodeStatsQuery(correlationIds, tenant);
  const rows = await deps.queryNodeStats(query);

  log(
    `handleNodeStatsRequest: OK tenant=${tenant} correlation_id_count=${correlationIds.length} row_count=${rows.length}`
  );

  const response = toNodeStatsResponse(tenant, correlationIds.length, rows);
  return { status: 200, body: response };
}
