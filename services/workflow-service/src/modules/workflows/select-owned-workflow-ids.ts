import type { IWorkflowExecutionRow } from "./executions.repository.interface";

/** Rows must come from the tenant-scoped repository; projected status is irrelevant. */
export function selectOwnedWorkflowIds(
  rows: readonly IWorkflowExecutionRow[],
  definitionId: string
): ReadonlySet<string> {
  return new Set(
    rows
      .filter((row) => row.definition_id === definitionId)
      .map((row) => row.temporal_workflow_id)
  );
}
