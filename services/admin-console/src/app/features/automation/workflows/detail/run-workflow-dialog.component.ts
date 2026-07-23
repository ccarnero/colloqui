import { Component } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";

/**
 * "Run now" confirmation dialog — collects an optional agent timeout before
 * kicking off an execution. Extracted from `workflow-detail.component.ts`
 * (T02) so `WorkflowRunActionsService` can reuse the exact same dialog from
 * both the detail wrapper's header actions and the builder's floating
 * chrome, without either component importing the other.
 */
@Component({
  selector: "app-run-workflow-dialog",
  standalone: true,
  template: `
    <h2 mat-dialog-title>Run Workflow</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" style="width: 100%;">
        <mat-label>Agent Timeout (seconds)</mat-label>
        <input matInput type="number" [formControl]="timeoutControl" min="60" max="3600" />
        <mat-hint>Default: 900 (15 minutes). Max: 3600 (1 hour).</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" [mat-dialog-close]="timeoutControl.value">
        Execute
      </button>
    </mat-dialog-actions>
  `,
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatButtonModule,
  ],
})
export class RunWorkflowDialogComponent {
  readonly timeoutControl = new FormControl(900, { nonNullable: true });
}
