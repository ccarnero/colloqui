import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-scheduler",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Scheduler</div>
        <div class="ws-subtitle">Cron jobs and scheduled maintenance tasks</div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">
          + New job
        </button>
      </div>
    </div>

    <div class="section-card">
      <table mat-table [dataSource]="jobs">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let j">{{ j.name }}</td>
        </ng-container>
        <ng-container matColumnDef="schedule">
          <th mat-header-cell *matHeaderCellDef>Schedule</th>
          <td mat-cell *matCellDef="let j">
            <span class="cron">{{ j.cron }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="nextRun">
          <th mat-header-cell *matHeaderCellDef>Next run</th>
          <td mat-cell *matCellDef="let j">{{ j.nextRun }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let j">
            <app-status-badge [status]="j.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="lastRun">
          <th mat-header-cell *matHeaderCellDef>Last run</th>
          <td mat-cell *matCellDef="let j">{{ j.lastRun }}</td>
        </ng-container>
        <ng-container matColumnDef="duration">
          <th mat-header-cell *matHeaderCellDef>Duration</th>
          <td mat-cell *matCellDef="let j">{{ j.duration }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let j">
            <button
              mat-icon-button
              type="button"
              aria-label="Run now"
              class="icon-btn"
            >
              <mat-icon>play_arrow</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              aria-label="Edit job"
              class="icon-btn"
            >
              <mat-icon>edit</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </div>
  `,
  styles: `
    .cron {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        monospace;
      font-size: 12px;
      color: var(--text2);
    }
    .icon-btn {
      color: var(--text3);
    }
  `,
})
export class SchedulerComponent {
  readonly columns = [
    "name",
    "schedule",
    "nextRun",
    "status",
    "lastRun",
    "duration",
    "actions",
  ] as const;

  readonly jobs = [
    {
      name: "Usage rollup",
      cron: "0 * * * *",
      nextRun: "Mar 20, 3:00 PM",
      status: "active",
      lastRun: "Mar 20, 2:00 PM",
      duration: "12s",
    },
    {
      name: "Audit log archive",
      cron: "15 2 * * *",
      nextRun: "Mar 21, 2:15 AM",
      status: "active",
      lastRun: "Mar 20, 2:15 AM",
      duration: "4m 2s",
    },
    {
      name: "Integration health ping",
      cron: "*/5 * * * *",
      nextRun: "in 2 min",
      status: "paused",
      lastRun: "Mar 18, 4:55 PM",
      duration: "890ms",
    },
  ];
}
