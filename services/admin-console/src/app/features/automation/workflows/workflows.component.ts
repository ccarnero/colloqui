import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { forkJoin, of } from "rxjs";
import { catchError } from "rxjs/operators";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "./services/workflow-api.service";

@Component({
  selector: "app-workflows",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UtcDatePipe,
    MatButtonModule,
    MatIconModule,
    PageHeaderComponent,
    StatusBadgeComponent,
  ],
  template: `
    <app-page-header
      title="Workflows"
      subtitle="Automate business processes"
    >
      <ng-container slot="actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="createNew()"
        >
          + New Workflow
        </button>
      </ng-container>
    </app-page-header>

    @if (loading()) {
      <div class="wf-loading">Loading workflows...</div>
    }

    @for (wf of workflows(); track wf.id) {
      <div class="section-card wf-card" (click)="openEditor(wf.id)">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">{{ wf.name }}</div>
            <div class="section-card-sub">
              {{ triggerLabel(wf) }} · {{ wf.application }}
            </div>
          </div>
          <app-status-badge
            [status]="wf.trigger ? 'active' : 'draft'"
          />
        </div>
        <div class="section-card-body wf-meta">
          <span class="wf-meta-item">
            <mat-icon>account_tree</mat-icon>
            {{ actionCount(wf) }} actions
          </span>
          <span class="wf-meta-item">
            <mat-icon>schedule</mat-icon>
            {{ wf.createdAt | utcDate }}
          </span>
          <span class="wf-meta-item">
            <mat-icon>history</mat-icon>
            {{ executionCount(wf) }} executions
          </span>
          <span class="wf-meta-spacer"></span>
          <button
            mat-icon-button
            type="button"
            class="wf-delete-btn"
            aria-label="Delete workflow"
            [disabled]="deletingId() === wf.id"
            (click)="onDeleteClick($event, wf)"
          >
            <mat-icon>delete</mat-icon>
          </button>
        </div>
      </div>
    }

    @if (!loading() && workflows().length === 0) {
      <div class="wf-empty">
        <mat-icon class="wf-empty-icon">account_tree</mat-icon>
        <div class="wf-empty-title">No workflows yet</div>
        <div class="wf-empty-sub">
          Create your first workflow to automate business processes
        </div>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="createNew()"
        >
          + New Workflow
        </button>
      </div>
    }
  `,
  styles: `
    .wf-card {
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .wf-card:hover {
      border-color: var(--accent);
    }
    .wf-meta {
      display: flex;
      gap: 20px;
      align-items: center;
    }
    .wf-meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text3);
    }
    .wf-meta-item mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .wf-meta-spacer {
      flex: 1;
    }
    .wf-delete-btn {
      color: var(--text3);
      transition: color 0.15s;
    }
    .wf-delete-btn:hover:not([disabled]) {
      color: var(--red, #dc2626);
    }
    .wf-loading {
      text-align: center;
      padding: 40px;
      color: var(--text3);
    }
    .wf-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 20px;
      text-align: center;
      gap: 8px;
    }
    .wf-empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--text3);
      margin-bottom: 8px;
    }
    .wf-empty-title {
      font-size: 16px;
      font-weight: 600;
    }
    .wf-empty-sub {
      font-size: 13px;
      color: var(--text3);
      margin-bottom: 12px;
    }
  `,
})
export class WorkflowsComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly workflows = signal<IWorkflowDefinitionDto[]>([]);
  readonly loading = signal(true);
  /** Tracks the workflow currently being deleted to disable its row. */
  readonly deletingId = signal<string | null>(null);
  /**
   * `definitionId -> executionsCount` lookup table. A `Map` is chosen
   * over a plain object so per-card lookups stay O(1) regardless of
   * the workflow set size.
   */
  readonly executionCounts = signal<Map<string, number>>(new Map());

  ngOnInit(): void {
    this.loadWorkflows();
  }

  private loadWorkflows(): void {
    this.loading.set(true);
    // Run both requests in parallel so total wall time is `max(list,
    // counts)` instead of `list + counts`. `catchError` on the counts
    // stream isolates failures: a counts outage shouldn't blank out
    // the workflow list.
    forkJoin({
      list: this.api.list(),
      counts: this.api
        .getExecutionCounts()
        .pipe(catchError(() => of<Record<string, number>>({}))),
    }).subscribe({
      next: ({ list, counts }) => {
        this.workflows.set(list);
        this.executionCounts.set(new Map(Object.entries(counts)));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  createNew(): void {
    this.router.navigate(["/workflows", "new"]);
  }

  /**
   * Card click opens the workflow detail mini-app (Overview sub-tab).
   * Users get to the Builder via the "Edit" action in the detail
   * header, or via the Builder sub-tab. Old `/workflows/:id/edit`
   * deep links still work — the route-level redirect handles them.
   */
  openEditor(id: string): void {
    this.router.navigate(["/workflows", id]);
  }

  triggerLabel(wf: IWorkflowDefinitionDto): string {
    if (!wf.trigger) {
      return "No trigger";
    }
    const t = wf.trigger as { type: string };
    return t.type === "message_received" ? "Channel" : t.type;
  }

  actionCount(wf: IWorkflowDefinitionDto): number {
    return Array.isArray(wf.actions) ? wf.actions.length : 0;
  }

  /** O(1) lookup against the prefetched `executionCounts` map. */
  executionCount(wf: IWorkflowDefinitionDto): number {
    return this.executionCounts().get(wf.id) ?? 0;
  }

  /**
   * Opens a confirm dialog before issuing the delete. Stops propagation
   * so the parent card click (which opens the editor) does not fire.
   */
  onDeleteClick(event: Event, wf: IWorkflowDefinitionDto): void {
    event.stopPropagation();
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
        { data, autoFocus: false, restoreFocus: true }
      )
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) {
          this.deleteWorkflow(wf);
        }
      });
  }

  private deleteWorkflow(wf: IWorkflowDefinitionDto): void {
    this.deletingId.set(wf.id);
    this.api.delete(wf.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.workflows.update((list) => list.filter((w) => w.id !== wf.id));
        this.snackBar.open("Workflow deleted", "OK", {
          duration: 3000,
        });
      },
      error: () => {
        this.deletingId.set(null);
        this.snackBar.open("Failed to delete workflow", "OK", {
          duration: 5000,
        });
      },
    });
  }
}
