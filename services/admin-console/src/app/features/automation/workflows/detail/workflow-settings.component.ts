import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../../shared/components/confirm-dialog/confirm-dialog.component";
import {
  WorkflowApiService,
  type IWorkflowDefinitionDto,
} from "../services/workflow-api.service";

interface IVariableEntry {
  key: string;
  value: string;
}

/**
 * Workflow Settings sub-tab.
 *
 * Holds non-builder workflow configuration. Phase 3 ships a calmer
 * "info + delete" page here: the Builder tab still owns trigger,
 * actions, and node-level config because that's where they're being
 * authored. Future phases can pull retry policy, env vars, version
 * history, etc. into this tab.
 */
@Component({
  selector: "app-workflow-settings",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <section class="ws">
      @if (loading()) {
        <p class="empty">Loading…</p>
      }

      @if (!loading() && workflow(); as wf) {
        <div class="card">
          <h2 class="card-h">Identity</h2>
          <dl class="kv">
            <dt>Name</dt><dd>{{ wf.name }}</dd>
            <dt>Application</dt><dd>{{ wf.application }}</dd>
            <dt>Definition ID</dt><dd class="mono">{{ wf.id }}</dd>
            <dt>Tenant</dt><dd class="mono">{{ wf.tenantId }}</dd>
            <dt>Created</dt><dd>{{ wf.createdAt }}</dd>
          </dl>
        </div>

        <div class="card">
          <h2 class="card-h">Triggers & actions</h2>
          <p class="muted">
            Triggers, actions and per-node configuration are edited in the
            <a class="link" (click)="goBuilder()">Builder</a> tab.
          </p>
          <ul class="muted-list">
            <li>{{ actionCount(wf) }} actions configured</li>
            <li>{{ wf.trigger ? 'Trigger configured' : 'No trigger configured' }}</li>
          </ul>
        </div>

        <div class="card">
          <h2 class="card-h">Workflow Variables</h2>
          <p class="muted">
            Define workflow-level variables available at runtime as
            <code class="inline-code">{{ '{{' }}variables.workflow.X{{ '}}' }}</code>.
          </p>

          <div class="var-grid">
            @for (entry of variableEntries(); track $index) {
              <div class="var-row">
                <mat-form-field appearance="outline" class="var-field">
                  <mat-label>Key</mat-label>
                  <input
                    matInput
                    [ngModel]="entry.key"
                    (ngModelChange)="onVarKeyChange($index, $event)"
                  />
                </mat-form-field>
                <mat-form-field appearance="outline" class="var-field">
                  <mat-label>Value</mat-label>
                  <input
                    matInput
                    [ngModel]="entry.value"
                    (ngModelChange)="onVarValueChange($index, $event)"
                  />
                </mat-form-field>
                <button
                  mat-icon-button
                  type="button"
                  class="var-remove-btn"
                  (click)="removeVariable($index)"
                >
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>

          @if (variableEntries().length === 0) {
            <p class="empty-vars">No variables defined.</p>
          }

          <div class="var-actions">
            <button
              mat-stroked-button
              type="button"
              (click)="addVariable()"
            >
              <mat-icon>add</mat-icon>
              Add variable
            </button>
            <button
              mat-flat-button
              type="button"
              [disabled]="savingVars()"
              (click)="saveVariables()"
            >
              <mat-icon>save</mat-icon>
              Save variables
            </button>
          </div>
        </div>

        <div class="card danger-card">
          <h2 class="card-h">Danger zone</h2>
          <p class="muted">Deleting a workflow stops all future executions. Past run history is preserved.</p>
          <button
            class="btn btn-danger"
            type="button"
            [disabled]="deleting()"
            (click)="confirmDelete(wf)"
          >
            Delete workflow
          </button>
        </div>
      }

      @if (!loading() && !workflow()) {
        <p class="empty">Workflow not found.</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .ws {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 14px 16px;
    }
    .card-h {
      font-size: 13px;
      font-weight: 500;
      margin: 0 0 10px;
      color: var(--text-primary);
    }
    .kv {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 6px 12px;
      margin: 0;
      font-size: 12px;
    }
    .kv dt { color: var(--text2); }
    .kv dd { margin: 0; color: var(--text-primary); }
    .mono { font-family: var(--font-mono, monospace); font-size: 11px; }
    .muted { color: var(--text2); font-size: 12px; margin: 0 0 8px; }
    .muted-list {
      margin: 0;
      padding-left: 18px;
      color: var(--text2);
      font-size: 12px;
    }
    .link { color: var(--primary, #1a66ff); cursor: pointer; }
    .danger-card { border-color: var(--red, #ef4444); }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn-danger {
      background: var(--red, #ef4444);
      color: #fff;
      border-color: var(--red, #ef4444);
    }
    .btn[disabled] { opacity: 0.6; cursor: not-allowed; }
    .empty { font-size: 12px; color: var(--text3); padding: 12px; text-align: center; }
    .inline-code {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      background: var(--bg2);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .var-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .var-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .var-field {
      flex: 1;
      font-size: 12px;
    }
    .var-remove-btn {
      flex-shrink: 0;
    }
    .empty-vars {
      font-size: 12px;
      color: var(--text3);
      margin: 0 0 8px;
    }
    .var-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
  `,
})
export class WorkflowSettingsComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} },
  );
  private readonly id = computed<string>(() => this.parentParams()["id"] ?? "");

  readonly workflow = signal<IWorkflowDefinitionDto | null>(null);
  readonly loading = signal(true);
  readonly deleting = signal(false);
  readonly savingVars = signal(false);

  /** Editable variable entries derived from the workflow definition. */
  readonly variableEntries = signal<IVariableEntry[]>([]);

  ngOnInit(): void {
    const id = this.id();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.api.get(id).subscribe({
      next: (wf) => {
        this.workflow.set(wf);
        this.syncVariableEntries(wf.variables);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected actionCount(wf: IWorkflowDefinitionDto): number {
    return Array.isArray(wf.actions) ? wf.actions.length : 0;
  }

  protected goBuilder(): void {
    void this.router.navigate(["/workflows", this.id(), "builder"]);
  }

  // ── Variables editor ──────────────────────────────────────────────

  private syncVariableEntries(
    variables?: Record<string, unknown>,
  ): void {
    if (!variables || typeof variables !== "object") {
      this.variableEntries.set([]);
      return;
    }
    const entries: IVariableEntry[] = Object.entries(variables).map(
      ([key, value]) => ({
        key,
        value:
          typeof value === "string"
            ? value
            : JSON.stringify(value),
      }),
    );
    this.variableEntries.set(entries);
  }

  addVariable(): void {
    this.variableEntries.update((entries) => [
      ...entries,
      { key: "", value: "" },
    ]);
  }

  removeVariable(index: number): void {
    this.variableEntries.update((entries) => {
      const next = [...entries];
      next.splice(index, 1);
      return next;
    });
  }

  onVarKeyChange(index: number, key: string): void {
    this.variableEntries.update((entries) => {
      const next = [...entries];
      next[index] = { ...next[index], key };
      return next;
    });
  }

  onVarValueChange(index: number, value: string): void {
    this.variableEntries.update((entries) => {
      const next = [...entries];
      next[index] = { ...next[index], value };
      return next;
    });
  }

  saveVariables(): void {
    const wf = this.workflow();
    if (!wf) return;

    const entries = this.variableEntries();
    const variables: Record<string, unknown> = {};
    for (const entry of entries) {
      if (!entry.key.trim()) continue;
      // Attempt to parse JSON values; fall back to raw string.
      let parsed: unknown = entry.value;
      if (
        entry.value.startsWith("{") ||
        entry.value.startsWith("[") ||
        entry.value === "true" ||
        entry.value === "false" ||
        entry.value === "null"
      ) {
        try {
          parsed = JSON.parse(entry.value);
        } catch {
          parsed = entry.value;
        }
      }
      variables[entry.key.trim()] = parsed;
    }

    this.savingVars.set(true);
    this.api
      .update(wf.id, {
        name: wf.name,
        application: wf.application,
        actions: wf.actions,
        trigger: wf.trigger ?? undefined,
        variables,
      })
      .subscribe({
        next: (saved) => {
          this.savingVars.set(false);
          this.workflow.set(saved);
          this.syncVariableEntries(saved.variables);
          this.snackBar.open("Variables saved", "OK", {
            duration: 3000,
          });
        },
        error: () => {
          this.savingVars.set(false);
          this.snackBar.open(
            "Failed to save variables",
            "OK",
            { duration: 5000 },
          );
        },
      });
  }

  // ── Delete ────────────────────────────────────────────────────────

  protected confirmDelete(wf: IWorkflowDefinitionDto): void {
    const data: IConfirmDialogData = {
      title: "Delete workflow",
      message: `Delete "${wf.name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      icon: "warning_amber",
    };
    this.dialog
      .open<ConfirmDialogComponent, IConfirmDialogData, boolean>(
        ConfirmDialogComponent,
        { data, autoFocus: false, restoreFocus: true },
      )
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) this.deleteWorkflow(wf);
      });
  }

  private deleteWorkflow(wf: IWorkflowDefinitionDto): void {
    this.deleting.set(true);
    this.api.delete(wf.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.snackBar.open("Workflow deleted", "OK", { duration: 3000 });
        void this.router.navigate(["/workflows"]);
      },
      error: () => {
        this.deleting.set(false);
        this.snackBar.open("Failed to delete workflow", "OK", { duration: 5000 });
      },
    });
  }
}
