import { Injectable, inject } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Router } from "@angular/router";
import { WorkflowApiService } from "../services/workflow-api.service";
import { RunWorkflowDialogComponent } from "./run-workflow-dialog.component";

/**
 * Shared "Run now" / "Pause" wiring for the workflow detail wrapper's
 * header actions AND the builder's floating chrome (T02, SPEC decision 2).
 * Both surfaces must fire the EXACT same service calls and confirmation
 * dialog, so the wiring lives here once instead of being duplicated between
 * `workflow-detail.component.ts` and `workflow-builder.component.ts`.
 */
@Injectable({ providedIn: "root" })
export class WorkflowRunActionsService {
  private readonly api = inject(WorkflowApiService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  /**
   * Opens the "Run now" confirmation dialog and, if confirmed, executes the
   * workflow then routes into Executions so the user sees the new run.
   * Identical wiring to the pre-T02 `WorkflowDetailComponent.runNow`.
   */
  runNow(id: string): void {
    console.debug("[WorkflowRunActionsService] run now requested", { id });

    const dialogRef = this.dialog.open(RunWorkflowDialogComponent, {
      width: "400px",
    });

    dialogRef.afterClosed().subscribe((timeoutSec: number | undefined) => {
      if (timeoutSec === undefined) {
        console.debug("[WorkflowRunActionsService] run now cancelled", { id });
        return; // Cancel
      }
      this.api.execute(id, { agentTimeoutSec: timeoutSec }).subscribe({
        next: () => {
          console.debug(
            "[WorkflowRunActionsService] run now executed, navigating to executions",
            { id, timeoutSec }
          );
          // After kicking off, route into Executions so the user sees it.
          void this.router.navigate(["/workflows", id, "executions"]);
        },
        error: (error: unknown) => {
          console.debug("[WorkflowRunActionsService] run now failed", {
            id,
            error,
          });
          /* swallow — could surface a snack later */
        },
      });
    });
  }

  /**
   * PHASE 3 TODO: wire pause action when API supports it. Identical no-op
   * to the pre-T02 `WorkflowDetailComponent.pause` — kept here so both
   * chrome surfaces share the same (currently inert) call site.
   */
  pause(id: string): void {
    console.debug(
      "[WorkflowRunActionsService] pause requested (no-op, API pending)",
      { id }
    );
  }
}
