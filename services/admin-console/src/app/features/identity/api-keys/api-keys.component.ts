import { Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { TenantService } from "../../../core/services/tenant.service";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-api-keys",
  imports: [MatTableModule, MatButtonModule, MatIconModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">API Keys</div>
        <div class="ws-subtitle">
          Programmatic access for {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">
          + Create API Key
        </button>
      </div>
    </div>

    <div class="section-card">
      <table mat-table [dataSource]="keys" class="full-width">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let k">
            <strong>{{ k.name }}</strong>
          </td>
        </ng-container>
        <ng-container matColumnDef="key">
          <th mat-header-cell *matHeaderCellDef>Key</th>
          <td mat-cell *matCellDef="let k" class="mono muted">{{ k.masked }}</td>
        </ng-container>
        <ng-container matColumnDef="scope">
          <th mat-header-cell *matHeaderCellDef>Scope</th>
          <td mat-cell *matCellDef="let k">
            <app-status-badge [status]="k.scope" [color]="'blue'" />
          </td>
        </ng-container>
        <ng-container matColumnDef="created">
          <th mat-header-cell *matHeaderCellDef>Created</th>
          <td mat-cell *matCellDef="let k" class="muted">{{ k.created }}</td>
        </ng-container>
        <ng-container matColumnDef="lastUsed">
          <th mat-header-cell *matHeaderCellDef>Last used</th>
          <td mat-cell *matCellDef="let k" class="muted">{{ k.lastUsed }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let k">
            <app-status-badge [status]="k.status" [color]="k.statusColor" />
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let k">
            <button
              mat-button
              color="warn"
              type="button"
              [disabled]="k.status === 'revoked'"
            >
              Revoke
            </button>
            <button mat-icon-button type="button" aria-label="Copy key id">
              <mat-icon>content_copy</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
      </table>
    </div>
  `,
  styles: `
    .full-width {
      width: 100%;
    }
    .mono {
      font-family: ui-monospace, monospace;
      font-size: 13px;
    }
    .muted {
      color: var(--text3);
    }
  `,
})
export class ApiKeysComponent {
  protected readonly tenant = inject(TenantService);
  readonly displayedColumns = [
    "name",
    "key",
    "scope",
    "created",
    "lastUsed",
    "status",
    "actions",
  ];
  readonly keys = [
    {
      name: "Production ingest",
      masked: "sk_live_••••••••••8f3a",
      scope: "read:write",
      created: "Mar 1, 2025",
      lastUsed: "2 min ago",
      status: "active",
      statusColor: "green" as const,
    },
    {
      name: "CI reports",
      masked: "sk_live_••••••••••91c2",
      scope: "read",
      created: "Feb 14, 2025",
      lastUsed: "4 hrs ago",
      status: "active",
      statusColor: "green" as const,
    },
    {
      name: "Legacy webhook",
      masked: "sk_test_••••••••••0dde",
      scope: "read:write",
      created: "Jan 3, 2025",
      lastUsed: "Never",
      status: "revoked",
      statusColor: "gray" as const,
    },
  ];
}
