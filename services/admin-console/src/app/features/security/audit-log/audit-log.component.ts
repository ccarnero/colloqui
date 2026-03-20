import { Component, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatPaginatorModule } from "@angular/material/paginator";
import { MatTableModule } from "@angular/material/table";

interface AuditLogRow {
  time: string;
  user: string;
  action: string;
  resource: string;
  ip: string;
}

@Component({
  selector: "app-audit-log",
  standalone: true,
  imports: [MatTableModule, MatButtonModule, MatPaginatorModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Audit Log</div>
        <div class="ws-subtitle">Track all platform actions and changes</div>
      </div>
      <div class="ws-actions">
        <button type="button" class="btn btn-secondary btn-sm">Export</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="logs()">
        <ng-container matColumnDef="time">
          <th mat-header-cell *matHeaderCellDef>Timestamp</th>
          <td mat-cell *matCellDef="let l" style="font-family:monospace">
            {{ l.time }}
          </td>
        </ng-container>
        <ng-container matColumnDef="user">
          <th mat-header-cell *matHeaderCellDef>User</th>
          <td mat-cell *matCellDef="let l">{{ l.user }}</td>
        </ng-container>
        <ng-container matColumnDef="action">
          <th mat-header-cell *matHeaderCellDef>Action</th>
          <td mat-cell *matCellDef="let l">
            <span class="badge badge-blue">{{ l.action }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="resource">
          <th mat-header-cell *matHeaderCellDef>Resource</th>
          <td mat-cell *matCellDef="let l">{{ l.resource }}</td>
        </ng-container>
        <ng-container matColumnDef="ip">
          <th mat-header-cell *matHeaderCellDef>IP Address</th>
          <td
            mat-cell
            *matCellDef="let l"
            style="font-family:monospace;color:var(--text3)"
          >
            {{ l.ip }}
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
      <mat-paginator
        [length]="200"
        [pageSize]="10"
        [pageSizeOptions]="[10, 25, 50]"
        showFirstLastButtons
      />
    </div>
  `,
})
export class AuditLogComponent {
  readonly cols = ["time", "user", "action", "resource", "ip"] as const;

  readonly logs = signal<AuditLogRow[]>([
    {
      time: "14:32:01",
      user: "alice@acme.com",
      action: "user.created",
      resource: "frank@acme.com",
      ip: "192.168.1.10",
    },
    {
      time: "14:28:44",
      user: "alice@acme.com",
      action: "role.updated",
      resource: "Editor",
      ip: "192.168.1.10",
    },
    {
      time: "14:15:22",
      user: "bob@acme.com",
      action: "apikey.created",
      resource: "CI/CD Pipeline",
      ip: "10.0.0.5",
    },
    {
      time: "13:55:10",
      user: "eva@acme.com",
      action: "settings.updated",
      resource: "MFA Policy",
      ip: "192.168.1.22",
    },
    {
      time: "13:40:05",
      user: "system",
      action: "quota.warning",
      resource: "API Calls (85%)",
      ip: "—",
    },
    {
      time: "13:22:18",
      user: "carol@acme.com",
      action: "export.created",
      resource: "users_export.csv",
      ip: "10.0.0.8",
    },
    {
      time: "12:58:33",
      user: "alice@acme.com",
      action: "webhook.updated",
      resource: "Slack Notifier",
      ip: "192.168.1.10",
    },
    {
      time: "12:30:00",
      user: "system",
      action: "backup.completed",
      resource: "daily-backup-2025",
      ip: "—",
    },
  ]);
}
