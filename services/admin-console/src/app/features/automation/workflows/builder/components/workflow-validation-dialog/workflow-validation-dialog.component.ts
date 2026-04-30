import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";

import type { ValidationError } from "../../../domain/validation/validation.types";

export interface IWorkflowValidationDialogData {
  errors: ValidationError[];
}

interface NodeGroup {
  nodeKey: string | null;
  nodeName: string;
  errors: ValidationError[];
}

const WORKFLOW_LEVEL_KEY = "__workflow__";

/**
 * Modal that lists pre-save validation errors grouped by node.
 * Errors without a `nodeKey` are surfaced under "Workflow".
 */
@Component({
  selector: "app-workflow-validation-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon class="dialog-title-icon">error_outline</mat-icon>
      Cannot save workflow
    </h2>
    <mat-dialog-content class="dialog-content">
      <p class="dialog-summary">
        Fix the following
        {{ errors().length === 1 ? "issue" : "issues" }}
        before saving:
      </p>

      @for (group of groups(); track group.nodeKey) {
        <section class="error-group">
          <header class="error-group-header">
            <mat-icon class="error-group-icon">
              {{ group.nodeKey ? "memory" : "warning_amber" }}
            </mat-icon>
            <span class="error-group-name">{{ group.nodeName }}</span>
            <span class="error-group-count">
              {{ group.errors.length }}
            </span>
          </header>
          <ul class="error-list">
            @for (err of group.errors; track $index) {
              <li class="error-item">
                @if (err.field) {
                  <code class="error-field">{{ err.field }}</code>
                }
                <span class="error-message">{{ err.message }}</span>
              </li>
            }
          </ul>
        </section>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" (click)="close()">
        Close
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 420px;
      max-width: 560px;
    }
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .dialog-title-icon {
      color: var(--warn, #d97706);
    }
    .dialog-content {
      padding-top: 8px;
      max-height: 60vh;
      overflow-y: auto;
    }
    .dialog-summary {
      margin: 0 0 12px;
      color: var(--text2);
      font-size: 13px;
    }
    .error-group {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 8px;
      background: var(--bg2);
    }
    .error-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 6px;
    }
    .error-group-icon {
      color: var(--text3);
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .error-group-name {
      flex: 1;
    }
    .error-group-count {
      font-size: 12px;
      color: var(--text3);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 1px 8px;
    }
    .error-list {
      margin: 0;
      padding-left: 16px;
      list-style: disc;
    }
    .error-item {
      font-size: 13px;
      line-height: 1.45;
      margin-bottom: 4px;
    }
    .error-field {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 1px 5px;
      margin-right: 6px;
      color: var(--text2);
    }
    .error-message {
      color: var(--text);
    }
  `,
})
export class WorkflowValidationDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<WorkflowValidationDialogComponent>
  >(MatDialogRef);
  private readonly data = inject<IWorkflowValidationDialogData>(
    MAT_DIALOG_DATA,
  );

  readonly errors = computed(() => this.data.errors);

  readonly groups = computed<NodeGroup[]>(() => {
    const map = new Map<string, NodeGroup>();
    for (const err of this.data.errors) {
      const key = err.nodeKey ?? WORKFLOW_LEVEL_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.errors.push(err);
        continue;
      }
      map.set(key, {
        nodeKey: err.nodeKey ?? null,
        nodeName: err.nodeKey
          ? (err.nodeName ?? "Unnamed node")
          : "Workflow",
        errors: [err],
      });
    }
    // Workflow-level group first, then node-specific groups in
    // insertion order.
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      if (a.nodeKey === null && b.nodeKey !== null) return -1;
      if (a.nodeKey !== null && b.nodeKey === null) return 1;
      return 0;
    });
    return groups;
  });

  close(): void {
    this.dialogRef.close();
  }
}
