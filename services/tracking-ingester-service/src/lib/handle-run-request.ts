// Orchestrates the `GET /runs/:workflowId/:runId` request (T01 of
// manual-loops/run-view.md): tenant guard, the run-root resolution query,
// the correlation-scoped events/spans fetch, and shaping via
// `toRunResponse` — WITHOUT touching a concrete Postgres client. Same
// injected-I/O shape as `handle-chain-request.ts`: the actual
// `sql.unsafe(...)` round trips are bound in `src/main.ts` (the only I/O
// edge), so this stays trivially testable with a stubbed pool.

import {
  buildRunEventsQuery,
  type RunEventRow,
  type RunEventsQuery,
} from "./build-run-events-query.js";
import {
  buildRunRootQuery,
  type RunRootQuery,
  type RunRootRow,
} from "./build-run-root-query.js";
import {
  buildSpansQuery,
  type ChainSpanRow,
  type SpansQuery,
} from "./build-spans-query.js";
import { type RunResponse, toRunResponse } from "./to-run-response.js";

export interface RunRequestDeps {
  /** Executes the run-root resolution query — normally
   * `sql.unsafe(query.text, query.params)`. */
  readonly queryRoot: (query: RunRootQuery) => Promise<readonly RunRootRow[]>;
  /** Executes the run events query — same client, over `tracked_events`. */
  readonly queryEvents: (
    query: RunEventsQuery
  ) => Promise<readonly RunEventRow[]>;
  /** Executes the spans query — same client, over `tracked_event_spans`. */
  readonly querySpans: (query: SpansQuery) => Promise<readonly ChainSpanRow[]>;
  /** Optional line logger for verbose query-path logging. */
  readonly log?: (message: string) => void;
}

export type RunRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | { readonly status: 404; readonly body: { readonly error: string } }
  | { readonly status: 200; readonly body: RunResponse };

/**
 * Handles a run read: 400 when `tenant` is missing (the gateway proxy
 * always sets `x-yoizen-tenant`; a missing header means the request
 * bypassed the gateway), 404 when `(workflowId, runId)` resolves to no
 * `execution_started` row for the tenant scope (unknown run, OR a
 * genuinely pre-step-events run — see build-run-root-query.ts's header),
 * otherwise 200 with the shaped `RunResponse`.
 */
export async function handleRunRequest(
  workflowId: string,
  runId: string,
  tenant: string | null,
  deps: RunRequestDeps
): Promise<RunRequestResult> {
  const log = deps.log ?? ((): void => {});

  if (tenant === null || tenant.trim().length === 0) {
    log(
      `handleRunRequest: REJECTED workflow_id=${workflowId} run_id=${runId} — missing x-yoizen-tenant header`
    );
    return {
      status: 400,
      body: { error: "missing x-yoizen-tenant header" },
    };
  }

  log(
    `handleRunRequest: resolving run root workflow_id=${workflowId} run_id=${runId} tenant=${tenant}`
  );

  const rootQuery = buildRunRootQuery(workflowId, runId, tenant);
  const rootRows = await deps.queryRoot(rootQuery);

  if (rootRows.length === 0) {
    log(
      `handleRunRequest: NOT FOUND workflow_id=${workflowId} run_id=${runId} tenant=${tenant} — no execution_started row`
    );
    return {
      status: 404,
      body: {
        error: `no run found for workflowId ${workflowId} runId ${runId}`,
      },
    };
  }

  const correlationId = rootRows[0]!.correlation_id;
  log(
    `handleRunRequest: resolved correlation_id=${correlationId} workflow_id=${workflowId} run_id=${runId}`
  );

  const eventsQuery = buildRunEventsQuery(correlationId, tenant);
  const spansQuery = buildSpansQuery(correlationId, tenant);

  const [events, spans] = await Promise.all([
    deps.queryEvents(eventsQuery),
    deps.querySpans(spansQuery),
  ]);

  log(
    `handleRunRequest: correlation_id=${correlationId} workflow_id=${workflowId} run_id=${runId} correlation_events=${events.length} correlation_spans=${spans.length} (may include sibling runs sharing this correlation — toRunResponse scopes down to this run's own events)`
  );

  if (events.length === 0) {
    // Defensive: the root row itself is part of this correlation, so this
    // should be unreachable in practice, but never assume the second query
    // mirrors the first.
    log(
      `handleRunRequest: NOT FOUND workflow_id=${workflowId} run_id=${runId} correlation_id=${correlationId} — zero events on re-fetch`
    );
    return {
      status: 404,
      body: {
        error: `no events found for run correlation_id ${correlationId}`,
      },
    };
  }

  const response = toRunResponse(
    workflowId,
    runId,
    correlationId,
    tenant,
    events,
    spans
  );
  log(
    `handleRunRequest: OK workflow_id=${workflowId} run_id=${runId} correlation_id=${correlationId} status=${response.summary.status} steps_ok=${response.summary.steps_ok} steps_failed=${response.summary.steps_failed} run_events=${response.events.length} run_spans=${response.spans.length} cast=${response.cast.length} step_detail=${response.step_detail}`
  );
  return { status: 200, body: response };
}
