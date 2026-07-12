// build-run-root-query.ts — resolves the `correlation_id` that anchors a
// workflow run, given the real Temporal `(workflowId, runId)` pair from the
// URL (T01 of manual-loops/run-view.md).
//
// FINDING (investigated against the actual emitter — see
// extract-detail-columns.ts and services/workflow-service/src/temporal/
// workflows.ts / execution-completed-publisher.activity.ts): the
// `workflow_id`/`run_id` columns are populated ONLY by the `execution_started`
// event. Every other event in the run family (`action_started`,
// `action_completed`, `condition_evaluated`, `execution_completed`) carries
// only `executionId` in its payload — never `workflowId`/`runId` — so
// `extractDetailColumns` (rule 19) leaves `run_id` NULL and falls
// `workflow_id` back to `executionId` for those rows (see that file's
// header comment). Filtering the FULL run by `workflow_id`/`run_id` columns
// directly is therefore not viable: only `execution_started` would match.
//
// Query strategy actually supported by the data: `execution_started` is
// ALWAYS published with a `correlation_id` that becomes the shared
// correlation root for every other event of the SAME run (see
// `workflows.ts` — `stepEvents.actionCausal.correlation_id` derives from
// `context.causal?.correlation_id ?? executionStartedEventId`, and
// `execution_completed` reuses `context.causal.correlation_id`). So this
// query resolves `correlation_id` from the one row that DOES carry the real
// `(workflowId, runId)` pair, and the caller (`handleRunRequest`) then reuses
// the SAME correlation-scoped query shape as the chains endpoint
// (`build-run-events-query.ts`) to pull every event of the run — mirroring
// how `handle-chain-request.ts` composes `build-chain-query.ts`.
//
// Reported gap (not silently worked around): a genuinely pre-step-events
// run — before `manual-loops/workflow-step-events.md` shipped
// `execution_started` — never recorded a real `workflowId`/`runId` at all
// (only `execution_completed` existed, with `executionId` only). Such runs
// are NOT resolvable by `(workflowId, runId)` today and correctly 404 here;
// the ONLY way to reach them is via `GET /chains/:correlationId` using the
// execution's `correlation_id`/`executionId` directly. If the product wants
// `(workflowId, runId)` lookups for those old runs too, the emitter would
// need to be able to backfill/derive a Temporal identity retroactively,
// which does not exist — out of scope for a read-only ingester endpoint.

export interface RunRootQuery {
  readonly text: string;
  readonly params: readonly [workflowId: string, runId: string, tenant: string];
}

export interface RunRootRow {
  readonly correlation_id: string;
}

/**
 * Builds the parametrized SQL that resolves the `correlation_id` anchoring a
 * run, from the `execution_started` row carrying the real `(workflowId,
 * runId)` pair, scoped to `tenant` (workflow-execution rows always carry a
 * real, non-null tenant — no `OR tenant IS NULL` drift-row allowance here,
 * unlike the chain/payload queries, since these are always canonical rows).
 */
export function buildRunRootQuery(
  workflowId: string,
  runId: string,
  tenant: string
): RunRootQuery {
  const text = `SELECT correlation_id
FROM tracking.tracked_events
WHERE workflow_id = $1
  AND run_id = $2
  AND kind = 'execution_started'
  AND tenant = $3
ORDER BY occurred_at
LIMIT 1`;

  return { text, params: [workflowId, runId, tenant] };
}
