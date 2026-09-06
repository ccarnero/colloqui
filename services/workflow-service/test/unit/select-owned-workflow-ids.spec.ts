import { describe, expect, it } from "bun:test";
import type { IWorkflowExecutionRow } from "../../src/modules/workflows/executions.repository.interface";
import { selectOwnedWorkflowIds } from "../../src/modules/workflows/select-owned-workflow-ids";

const row: IWorkflowExecutionRow = {
  id: "ex-1",
  definition_id: "def-1",
  temporal_workflow_id: "t1:old-name:abc",
  temporal_run_id: "run-1",
  correlation_id: null,
  request: {},
  status: "COMPLETED",
  created_at: new Date("2026-09-05T00:00:00Z"),
  updated_at: new Date("2026-09-05T00:00:00Z"),
};

describe("selectOwnedWorkflowIds", () => {
  for (const testCase of [
    { name: "empty rows", rows: [], expected: [] },
    { name: "old name and stale status", rows: [row], expected: [row.temporal_workflow_id] },
    { name: "another definition", rows: [{ ...row, definition_id: "def-2" }], expected: [] },
    { name: "duplicate IDs", rows: [row, row], expected: [row.temporal_workflow_id] },
    {
      name: "prefix collision belongs to another definition",
      rows: [row, { ...row, definition_id: "def-2", temporal_workflow_id: "t1:old-name:priority:abc" }],
      expected: [row.temporal_workflow_id],
    },
  ]) {
    it(testCase.name, () => {
      expect([...selectOwnedWorkflowIds(testCase.rows, "def-1")]).toEqual(testCase.expected);
    });
  }
});
