import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { Router, RouterOutlet } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { BreadcrumbsComponent } from "../../../../shared/components/breadcrumbs/breadcrumbs.component";
import {
  SubTabsComponent,
  type ISubTab,
} from "../../../../shared/components/sub-tabs/sub-tabs.component";
import { MatIconModule } from "@angular/material/icon";
import { SchedulerApiService } from "../../../../core/services/scheduler-api.service";
import type { IJob } from "../../../../core/models/scheduler.model";
import { ScheduleFormDialogComponent } from "../schedule-form-dialog.component";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../../shared/components/confirm-dialog/confirm-dialog.component";

/**
 * Shell for `/schedules/:id` — the schedule detail page. Renders:
 *   - breadcrumbs (Schedules / <name>)
 *   - title row (name + status pill + run/edit/enable/delete actions)
 *   - sub-tabs row (Overview / Executions)
 *   - <router-outlet /> for the active sub-tab
 */
@Component({
  selector: "app-schedule-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    BreadcrumbsComponent,
    SubTabsComponent,
    MatButtonModule,
    MatDialogModule,
    MatSnackBarModule,
    MatIconModule,
  ],
  template: `
    <div class="detail">
      <app-breadcrumbs [crumbs]="crumbs()" />

      <header class="detail-h">
        <div class="detail-title-block">
          <h1 class="detail-title">
            {{ job()?.name ?? id() }}
            @if (job(); as j) {
              <span
                class="status-pill"
                [class]="'status-' + (j.is_active ? 'active' : 'inactive')"
              >
                <span class="dot" aria-hidden="true"></span>
                {{ j.is_active ? "Active" : "Inactive" }}
              </span>
            }
          </h1>
        </div>
        <div class="detail-actions">
          <button class="btn" type="button" (click)="runNow()">
            <mat-icon>play_arrow</mat-icon>
            Run Now
          </button>
          <button class="btn" type="button" (click)="openEdit()">
            <mat-icon>edit</mat-icon>
            Edit
          </button>
          @if (job()?.is_active) {
            <button class="btn" type="button" (click)="toggleActive()">
              <mat-icon>pause</mat-icon>
              Disable
            </button>
          } @else {
            <button class="btn" type="button" (click)="toggleActive()">
              <mat-icon>play_arrow</mat-icon>
              Enable
            </button>
          }
          <button class="btn btn-danger" type="button" (click)="confirmDelete()">
            <mat-icon>delete</mat-icon>
            Delete
          </button>
        </div>
      </header>

      <app-sub-tabs [tabs]="tabs()" />

      <router-outlet />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .detail {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .detail-h {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .detail-title-block {
      min-width: 0;
    }
    .detail-title {
      font-size: 20px;
      font-weight: 500;
      margin: 0;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .status-pill {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 500;
    }
    .status-active {
      background: color-mix(in srgb, var(--green, #16a34a) 15%, transparent);
      color: var(--green, #16a34a);
    }
    .status-inactive {
      background: var(--bg3);
      color: var(--text2);
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: currentColor;
      opacity: 0.85;
    }
    .detail-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
      align-items: center;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn:hover { background: var(--bg3); }
    .btn-danger {
      color: var(--red, #ef4444);
      border-color: var(--red, #ef4444);
    }
    .btn-danger:hover {
      background: color-mix(in srgb, var(--red, #ef4444) 10%, transparent);
    }
    .btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `,
})
export class ScheduleDetailComponent implements OnInit {
  private readonly api = inject(SchedulerApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** Reactive id from the route param (`:id`). */
  private readonly params = toSignal(this.route.params, {
    initialValue: this.route.snapshot.params,
  });
  readonly id = computed<string>(() => this.params()["id"] ?? "");

  readonly job = signal<IJob | null>(null);

  readonly tabs = computed<ISubTab[]>(() => {
    const id = this.id();
    return [
      { label: "Overview", route: `/schedules/${id}/overview` },
      { label: "Executions", route: `/schedules/${id}/executions` },
    ];
  });

  readonly crumbs = computed(() => [
    { label: "Schedules", route: "/schedules" },
    { label: this.job()?.name ?? this.id() },
  ]);

  ngOnInit(): void {
    const id = this.id();
    if (id) {
      this.api.getJob(id).subscribe({
        next: (j) => this.job.set(j),
        // Failures here are non-fatal for the shell — the sub-tab will
        // surface its own errors as needed.
        error: () => this.job.set(null),
      });
    }
  }

  protected runNow(): void {
    const id = this.id();
    if (!id) return;

    this.api.runJob(id).subscribe({
      next: () => {
        this.snackBar.open("Job started", "OK", { duration: 3000 });
        void this.router.navigate(["/schedules", id, "executions"]);
      },
      error: () => {
        this.snackBar.open("Failed to start job", "OK", { duration: 5000 });
      },
    });
  }

  protected openEdit(): void {
    const id = this.id();
    if (!id) return;

    const dialogRef = this.dialog.open(ScheduleFormDialogComponent, {
      width: "500px",
      data: { job: this.job() },
    });

    dialogRef.afterClosed().subscribe((updated: IJob | undefined) => {
      if (updated) {
        this.job.set(updated);
      }
    });
  }

  protected toggleActive(): void {
    const id = this.id();
    const current = this.job();
    if (!id || !current) return;

    const toggle$ = current.is_active
      ? this.api.disableJob(id)
      : this.api.enableJob(id);

    toggle$.subscribe({
      next: (updated) => {
        this.job.set(updated);
        this.snackBar.open(
          updated.is_active ? "Job enabled" : "Job disabled",
          "OK",
          { duration: 3000 },
        );
      },
      error: () => {
        this.snackBar.open("Failed to toggle job", "OK", { duration: 5000 });
      },
    });
  }

  protected confirmDelete(): void {
    const id = this.id();
    const current = this.job();
    if (!id) return;

    const data: IConfirmDialogData = {
      title: "Delete schedule",
      message: `Delete "${current?.name ?? id}"? This action cannot be undone.`,
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
        if (confirmed === true) this.deleteJob();
      });
  }

  private deleteJob(): void {
    const id = this.id();
    if (!id) return;

    this.api.deleteJob(id).subscribe({
      next: () => {
        this.snackBar.open("Schedule deleted", "OK", { duration: 3000 });
        void this.router.navigate(["/schedules"]);
      },
      error: () => {
        this.snackBar.open("Failed to delete schedule", "OK", {
          duration: 5000,
        });
      },
    });
  }
}
