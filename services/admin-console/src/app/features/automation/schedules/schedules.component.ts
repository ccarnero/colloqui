import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { forkJoin } from "rxjs";
import type { IAgent } from "../../../core/models/agent.model";
import type { IJob } from "../../../core/models/scheduler.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { SchedulerApiService } from "../../../core/services/scheduler-api.service";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import type { IScheduleFormData } from "./schedule-form-dialog.component";

@Component({
  selector: "app-schedules",
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
      title="Schedules"
      subtitle="Manage scheduled job executions"
    >
      <ng-container slot="actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="openCreateDialog()"
        >
          + Create Schedule
        </button>
      </ng-container>
    </app-page-header>

    @if (loading()) {
      <div class="sc-loading">Loading schedules...</div>
    }

    <div class="schedules-grid">
      @for (job of jobs(); track job.id) {
        <div class="schedule-card" (click)="openDetail(job.id)">
          <!-- Header row: name + status badge -->
          <div class="schedule-card-header">
            <div class="schedule-card-title">{{ job.name }}</div>
            <app-status-badge
              [status]="job.is_active ? 'active' : 'inactive'"
              [color]="job.is_active ? 'green' : 'gray'"
            />
          </div>

          <!-- Sub row: schedule expression + agent -->
          <div class="schedule-card-sub">
            <mat-icon class="sc-sub-icon">schedule</mat-icon>
            {{ scheduleLabel(job) }}
            <span class="sc-dot">·</span>
            <mat-icon class="sc-sub-icon">smart_toy</mat-icon>
            {{ agentMap().get(job.agent_id) ?? job.agent_id }}
          </div>

          <!-- Dates row: last_run / next_run -->
          <div class="schedule-card-dates">
            @if (job.last_run) {
              <span class="sc-date-item">
                <mat-icon class="sc-date-icon">check_circle</mat-icon>
                Last: {{ job.last_run | utcDate }}
              </span>
            } @else {
              <span class="sc-date-item sc-date-muted">
                <mat-icon class="sc-date-icon">check_circle</mat-icon>
                Last: never
              </span>
            }
            @if (job.next_run) {
              <span class="sc-date-item">
                <mat-icon class="sc-date-icon">play_arrow</mat-icon>
                Next: {{ job.next_run | utcDate }}
              </span>
            } @else {
              <span class="sc-date-item sc-date-muted">
                <mat-icon class="sc-date-icon">play_arrow</mat-icon>
                Next: not scheduled
              </span>
            }
          </div>

          <!-- Actions row -->
          <div class="schedule-card-actions">
            <button
              mat-icon-button
              type="button"
              class="sc-action-btn"
              aria-label="Edit schedule"
              [disabled]="deletingId() === job.id"
              (click)="openEditDialog($event, job)"
            >
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              class="sc-action-btn"
              [attr.aria-label]="job.is_active ? 'Disable schedule' : 'Enable schedule'"
              [disabled]="togglingId() === job.id"
              (click)="toggleActive($event, job)"
            >
              <mat-icon>{{ job.is_active ? 'pause' : 'play_arrow' }}</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              class="sc-action-btn"
              aria-label="Run schedule now"
              [disabled]="runningId() === job.id"
              (click)="runNow($event, job)"
            >
              <mat-icon>bolt</mat-icon>
            </button>
            <span class="sc-actions-spacer"></span>
            <button
              mat-icon-button
              type="button"
              class="sc-delete-btn"
              aria-label="Delete schedule"
              [disabled]="deletingId() === job.id"
              (click)="onDeleteClick($event, job)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        </div>
      }
    </div>

    @if (!loading() && jobs().length === 0) {
      <div class="sc-empty">
        <mat-icon class="sc-empty-icon">schedule</mat-icon>
        <div class="sc-empty-title">No schedules yet</div>
        <div class="sc-empty-sub">
          Create your first schedule to automate job executions
        </div>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="openCreateDialog()"
        >
          + Create Schedule
        </button>
      </div>
    }

    <!-- Pagination -->
    @if (!loading() && totalPages() > 1) {
      <div class="sc-pagination">
        <button
          class="btn btn-outline btn-sm"
          type="button"
          [disabled]="offset() === 0"
          (click)="prevPage()"
        >
          Previous
        </button>
        <span class="sc-page-info">
          Page {{ currentPage() }} of {{ totalPages() }}
          &middot;
          {{ total() }} total
        </span>
        <button
          class="btn btn-outline btn-sm"
          type="button"
          [disabled]="offset() + limit >= total()"
          (click)="nextPage()"
        >
          Next
        </button>
      </div>
    }
  `,
  styles: `
    .sc-loading {
      text-align: center;
      padding: 40px;
      color: var(--text3);
    }

    .schedules-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .schedule-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--bg-surface, var(--bg3));
      border: 1px solid var(--border-subtle, #333);
      border-radius: var(--radius, 8px);
      padding: 16px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .schedule-card:hover {
      border-color: var(--accent);
    }

    .schedule-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .schedule-card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .schedule-card-sub {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: var(--text3);
    }
    .sc-sub-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .sc-dot {
      margin: 0 4px;
      color: var(--text3);
    }

    .schedule-card-dates {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .sc-date-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text3);
    }
    .sc-date-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .sc-date-muted {
      opacity: 0.5;
    }

    .schedule-card-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      padding-top: 4px;
      border-top: 1px solid var(--border-subtle, #333);
    }
    .sc-action-btn {
      color: var(--text3);
      transition: color 0.15s;
    }
    .sc-action-btn:hover:not([disabled]) {
      color: var(--text-primary);
    }
    .sc-actions-spacer {
      flex: 1;
    }
    .sc-delete-btn {
      color: var(--text3);
      transition: color 0.15s;
    }
    .sc-delete-btn:hover:not([disabled]) {
      color: var(--red, #dc2626);
    }

    .sc-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 20px;
      text-align: center;
      gap: 8px;
    }
    .sc-empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--text3);
      margin-bottom: 8px;
    }
    .sc-empty-title {
      font-size: 16px;
      font-weight: 600;
    }
    .sc-empty-sub {
      font-size: 13px;
      color: var(--text3);
      margin-bottom: 12px;
    }

    .sc-pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 20px 0;
    }
    .sc-page-info {
      font-size: 13px;
      color: var(--text3);
    }
  `,
})
export class SchedulesComponent implements OnInit {
  private readonly api = inject(SchedulerApiService);
  private readonly agentAdmin = inject(AgentAdminService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly limit = 20;
  readonly jobs = signal<IJob[]>([]);
  readonly loading = signal(true);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly deletingId = signal<string | null>(null);
  readonly togglingId = signal<string | null>(null);
  readonly runningId = signal<string | null>(null);
  readonly agentMap = signal<Map<string, string>>(new Map());

  readonly currentPage = computed(
    () => Math.floor(this.offset() / this.limit) + 1
  );
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit))
  );

  ngOnInit(): void {
    this.loadJobs();
  }

  // ==========================================================================
  // Data loading
  // ==========================================================================

  private loadJobs(): void {
    this.loading.set(true);
    forkJoin({
      list: this.api.listJobs({
        limit: this.limit,
        offset: this.offset(),
      }),
      agents: this.agentAdmin.listAgents({ status: "published" }),
    }).subscribe({
      next: ({ list, agents }) => {
        this.jobs.set(list.jobs);
        this.total.set(list.total);
        this.agentMap.set(
          new Map(agents.agents.map((a: IAgent) => [a.id, a.name]))
        );
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open("Failed to load schedules", "OK", {
          duration: 5000,
        });
      },
    });
  }

  // ==========================================================================
  // Navigation
  // ==========================================================================

  /**
   * Card click navigates to the schedule detail page.
   * Placeholder — the detail route may not exist yet.
   */
  openDetail(id: string): void {
    this.router.navigate(["/schedules", id]);
  }

  // ==========================================================================
  // Pagination
  // ==========================================================================

  nextPage(): void {
    this.offset.update((o) => o + this.limit);
    this.loadJobs();
  }

  prevPage(): void {
    this.offset.update((o) => Math.max(0, o - this.limit));
    this.loadJobs();
  }

  // ==========================================================================
  // Create / Edit dialogs
  // ==========================================================================

  /**
   * Opens the create-schedule form dialog via dynamic import so the
   * schedules list compiles independently of the dialog component.
   * Falls back to a "Coming soon" snackbar if the dialog module is
   * not yet available.
   */
  async openCreateDialog(): Promise<void> {
    try {
      const { ScheduleFormDialogComponent } = await import(
        "./schedule-form-dialog.component"
      );
      const ref = this.dialog.open(ScheduleFormDialogComponent, {
        width: "640px",
      });
      ref.afterClosed().subscribe((result: IScheduleFormData | undefined) => {
        if (!result) {
          return;
        }
        this.api
          .createJob({
            name: result.name,
            agent_id: result.agent_id,
            schedule: result.schedule,
            payload: result.payload
              ? this.parsePayload(result.payload)
              : undefined,
            is_active: result.is_active,
          })
          .subscribe({
            next: () => {
              this.snackBar.open("Schedule created", "OK", { duration: 3000 });
              this.loadJobs();
            },
            error: () => {
              this.snackBar.open("Failed to create schedule", "OK", {
                duration: 5000,
              });
            },
          });
      });
    } catch {
      this.snackBar.open("Coming soon", "OK", { duration: 3000 });
    }
  }

  /**
   * Opens the edit-schedule form dialog populated with the job data.
   */
  async openEditDialog(event: Event, job: IJob): Promise<void> {
    event.stopPropagation();
    try {
      const { ScheduleFormDialogComponent } = await import(
        "./schedule-form-dialog.component"
      );
      const ref = this.dialog.open(ScheduleFormDialogComponent, {
        width: "640px",
        data: job,
      });
      ref.afterClosed().subscribe((result: IScheduleFormData | undefined) => {
        if (!result) {
          return;
        }
        this.api
          .updateJob(job.id, {
            name: result.name,
            agent_id: result.agent_id,
            schedule: result.schedule,
            payload: result.payload
              ? this.parsePayload(result.payload)
              : undefined,
            is_active: result.is_active,
          })
          .subscribe({
            next: () => {
              this.snackBar.open("Schedule updated", "OK", { duration: 3000 });
              this.loadJobs();
            },
            error: () => {
              this.snackBar.open("Failed to update schedule", "OK", {
                duration: 5000,
              });
            },
          });
      });
    } catch {
      this.snackBar.open("Coming soon", "OK", { duration: 3000 });
    }
  }

  // ==========================================================================
  // Enable / Disable toggle
  // ==========================================================================

  toggleActive(event: Event, job: IJob): void {
    event.stopPropagation();
    this.togglingId.set(job.id);
    const call$ = job.is_active
      ? this.api.disableJob(job.id)
      : this.api.enableJob(job.id);

    call$.subscribe({
      next: (updated) => {
        this.togglingId.set(null);
        this.jobs.update((list) =>
          list.map((j) => (j.id === updated.id ? updated : j))
        );
      },
      error: () => {
        this.togglingId.set(null);
        this.snackBar.open(
          `Failed to ${job.is_active ? "disable" : "enable"} schedule`,
          "OK",
          { duration: 5000 }
        );
      },
    });
  }

  // ==========================================================================
  // Run Now
  // ==========================================================================

  runNow(event: Event, job: IJob): void {
    event.stopPropagation();
    this.runningId.set(job.id);
    this.api.runJob(job.id).subscribe({
      next: () => {
        this.runningId.set(null);
        this.snackBar.open(`"${job.name}" triggered successfully`, "OK", {
          duration: 3000,
        });
      },
      error: () => {
        this.runningId.set(null);
        this.snackBar.open(`Failed to run "${job.name}"`, "OK", {
          duration: 5000,
        });
      },
    });
  }

  // ==========================================================================
  // Delete
  // ==========================================================================

  onDeleteClick(event: Event, job: IJob): void {
    event.stopPropagation();
    const data: IConfirmDialogData = {
      title: "Delete schedule",
      message: `Delete "${job.name}"? This action cannot be undone.`,
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
          this.deleteJob(job);
        }
      });
  }

  private deleteJob(job: IJob): void {
    this.deletingId.set(job.id);
    this.api.deleteJob(job.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.jobs.update((list) => list.filter((j) => j.id !== job.id));
        this.snackBar.open("Schedule deleted", "OK", { duration: 3000 });
      },
      error: () => {
        this.deletingId.set(null);
        this.snackBar.open("Failed to delete schedule", "OK", {
          duration: 5000,
        });
      },
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Returns a human-readable label for the job's schedule.
   * - "interval:<n>" → shows "Every <n>m" (e.g. "Every 15m")
   * - "once"         → shows "Once"
   * - anything else  → shows "Cron: <expr>"
   */
  scheduleLabel(job: IJob): string {
    const s = job.schedule;
    if (s.startsWith("interval:")) {
      const minutes = s.replace("interval:", "");
      return `Every ${minutes}m`;
    }
    if (s === "once") {
      return "Once";
    }
    return `Cron: ${s}`;
  }

  /**
   * Parses a JSON string into an object. Returns undefined when the
   * input is empty, blank, or malformed so the API omits the field
   * rather than sending null.
   */
  private parsePayload(json: string): Record<string, unknown> | undefined {
    if (!json || !json.trim()) {
      return undefined;
    }
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}
