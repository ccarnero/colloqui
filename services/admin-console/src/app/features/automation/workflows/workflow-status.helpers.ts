import type { HealthStatus } from "../../../shared/components/status-badge/status-badge.component";
import type { IWorkflowDefinitionDto } from "./services/workflow-api.service";

/**
 * The three real, non-invented workflow states — same fields the
 * pre-redesign card badge used (T01 finding 1, `workflows.component.ts`
 * `isEnabled` at `:279-281` + the `wf.trigger ? "active" : "draft"`
 * template branch): a workflow is "disabled" when `status ===
 * "disabled"`, otherwise "active" when it has a trigger, otherwise
 * "draft".
 */
export type WorkflowStatusLabel = "active" | "draft" | "disabled";

/**
 * Derives the workflow's status label from real fields only —
 * `status` and `trigger`. Legacy rows have no persisted `status`;
 * missing/anything other than `"disabled"` is treated as enabled,
 * matching the previous `isEnabled` behavior.
 */
export function deriveWorkflowStatusLabel(
  wf: IWorkflowDefinitionDto
): WorkflowStatusLabel {
  if (wf.status === "disabled") {
    return "disabled";
  }
  return wf.trigger ? "active" : "draft";
}

/**
 * Maps the real status label to the shared health-dot vocabulary.
 * "draft" is a genuine third state (not fabricated), so it gets its
 * own "idle" dot rather than being forced into a binary ok/error split
 * — "disabled" is the only state that should surface in the
 * needs-attention panel, so it maps to "warn".
 */
export function mapWorkflowStatusToHealth(
  label: WorkflowStatusLabel
): HealthStatus {
  if (label === "active") {
    return "ok";
  }
  if (label === "draft") {
    return "idle";
  }
  return "warn";
}
