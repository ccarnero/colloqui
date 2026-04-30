/**
 * @deprecated Removed in this version. The popup it powered has been
 * superseded by the Executions sub-tab inside the workflow detail
 * mini-app (see features/automation/workflows/detail/workflow-executions.component.ts).
 *
 * Kept as a compile-clean stub because the sandbox can't physically
 * delete files. Safe to `git rm` during local cleanup.
 */
import { ChangeDetectionStrategy, Component } from "@angular/core";

export interface IWorkflowExecutionsDialogData {
  workflowId: string;
  workflowName: string;
}

@Component({
  selector: "app-workflow-executions-dialog-deprecated",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class WorkflowExecutionsDialogComponent {}
