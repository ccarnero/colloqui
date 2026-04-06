import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

interface IEmailTemplateRow {
  name: string;
  trigger: string;
  modified: string;
  status: string;
}

@Component({
  selector: "app-email-templates",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Email Templates</div>
        <div class="ws-subtitle">Transactional and alert message bodies</div>
      </div>
      <div class="ws-actions">
        <button type="button" class="btn btn-primary btn-sm">+ New template</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="templates()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let t">{{ t.name }}</td>
        </ng-container>
        <ng-container matColumnDef="trigger">
          <th mat-header-cell *matHeaderCellDef>Trigger event</th>
          <td mat-cell *matCellDef="let t">
            <span class="badge badge-blue">{{ t.trigger }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="modified">
          <th mat-header-cell *matHeaderCellDef>Last modified</th>
          <td mat-cell *matCellDef="let t" style="font-family:monospace">
            {{ t.modified }}
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let t">
            <app-status-badge [status]="t.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let t">
            <button type="button" mat-icon-button aria-label="Edit template">
              <mat-icon>edit</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class EmailTemplatesComponent {
  readonly cols = ["name", "trigger", "modified", "status", "actions"] as const;

  readonly templates = signal<IEmailTemplateRow[]>([
    {
      name: "Welcome — new user",
      trigger: "user.created",
      modified: "2025-03-18 09:14",
      status: "published",
    },
    {
      name: "Password reset",
      trigger: "auth.password_reset",
      modified: "2025-02-02 11:02",
      status: "published",
    },
    {
      name: "Quota warning (80%)",
      trigger: "billing.quota_warning",
      modified: "2025-01-20 16:40",
      status: "draft",
    },
    {
      name: "Security alert — new IP",
      trigger: "security.new_ip_login",
      modified: "2025-03-10 08:55",
      status: "published",
    },
    {
      name: "Export ready",
      trigger: "export.completed",
      modified: "2024-12-01 14:22",
      status: "archived",
    },
  ]);
}
