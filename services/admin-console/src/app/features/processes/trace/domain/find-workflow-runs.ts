import type { ITrackedEvent } from "../../../../core/services/tracking-chain.service";

/** One distinct workflow run referenced by a tracking chain. */
export interface IWorkflowRunRef {
  readonly workflowId: string;
  readonly runId: string;
}

/**
 * Detects the workflow run(s) referenced by a chain's events, for T06 of
 * `manual-loops/run-view.md` ("Run view" tab in trace detail).
 *
 * `ITrackedEvent.workflow_id`/`run_id` are the ingester's click-through
 * detail columns (TAXONOMY.md rule 19, workflow-service execution lifecycle).
 * In practice only `execution_started` carries BOTH non-null: per
 * `tracking-ingester-service/src/lib/extract-detail-columns.ts`, the
 * `execution_completed` bus event only emits `{ executionId, status,
 * workflowName? }` and never a `runId`, so those rows get `run_id: null`.
 * This scans every event and requires both fields non-null, so it naturally
 * resolves runs from `execution_started` without filtering by `kind`.
 *
 * Distinct `(workflow_id, run_id)` pairs are returned in first-seen order
 * (events already arrive `occurred_at`-ordered from the chain endpoint). A
 * chain can reference more than one run when a shared trigger fans out to
 * multiple workflow executions; the caller picks index 0 to keep the tab
 * simple (the visual contract mandates no selector for this case).
 */
export function findWorkflowRuns(
  events: readonly ITrackedEvent[]
): readonly IWorkflowRunRef[] {
  const seen = new Set<string>();
  const runs: IWorkflowRunRef[] = [];

  for (const event of events) {
    if (!event.workflow_id || !event.run_id) {
      continue;
    }
    const key = `${event.workflow_id} ${event.run_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    runs.push({ workflowId: event.workflow_id, runId: event.run_id });
  }

  return runs;
}
