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
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../../shared/components/confirm-dialog/confirm-dialog.component";
import {
  WorkflowApiService,
  type IWorkflowDefinitionDto,
} from "../services/workflow-api.service";

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
  imports: [],
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

  ngOnInit(): void {
    const id = this.id();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.api.get(id).subscribe({
      next: (wf) => {
        this.workflow.set(wf);
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
