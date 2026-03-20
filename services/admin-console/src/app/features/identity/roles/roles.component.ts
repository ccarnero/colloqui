import { Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { TenantService } from "../../../core/services/tenant.service";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-roles",
  imports: [MatTableModule, MatButtonModule, MatIconModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Roles &amp; Permissions</div>
        <div class="ws-subtitle">
          Define access for {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">
          + Create Role
        </button>
      </div>
    </div>

    <div class="section-card">
      <table mat-table [dataSource]="roles" class="full-width">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Role</th>
          <td mat-cell *matCellDef="let r">
            <strong>{{ r.name }}</strong>
            <div class="muted">{{ r.description }}</div>
          </td>
        </ng-container>
        <ng-container matColumnDef="users">
          <th mat-header-cell *matHeaderCellDef>Users</th>
          <td mat-cell *matCellDef="let r">{{ r.userCount }}</td>
        </ng-container>
        <ng-container matColumnDef="create">
          <th mat-header-cell *matHeaderCellDef>Create</th>
          <td mat-cell *matCellDef="let r">
            <mat-icon class="check" [class.off]="!r.crud.create">check</mat-icon>
          </td>
        </ng-container>
        <ng-container matColumnDef="read">
          <th mat-header-cell *matHeaderCellDef>Read</th>
          <td mat-cell *matCellDef="let r">
            <mat-icon class="check" [class.off]="!r.crud.read">check</mat-icon>
          </td>
        </ng-container>
        <ng-container matColumnDef="update">
          <th mat-header-cell *matHeaderCellDef>Update</th>
          <td mat-cell *matCellDef="let r">
            <mat-icon class="check" [class.off]="!r.crud.update">check</mat-icon>
          </td>
        </ng-container>
        <ng-container matColumnDef="delete">
          <th mat-header-cell *matHeaderCellDef>Delete</th>
          <td mat-cell *matCellDef="let r">
            <mat-icon class="check" [class.off]="!r.crud.delete">check</mat-icon>
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <app-status-badge [status]="r.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let r">
            <button mat-icon-button type="button" aria-label="Edit role">
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              color="warn"
              type="button"
              aria-label="Delete role"
              [disabled]="r.builtIn"
            >
              <mat-icon>delete</mat-icon>
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
    .muted {
      font-size: 12px;
      color: var(--text3);
      margin-top: 4px;
    }
    .check {
      color: var(--accent);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .check.off {
      color: var(--text3);
      opacity: 0.35;
    }
  `,
})
export class RolesComponent {
  protected readonly tenant = inject(TenantService);
  readonly displayedColumns = [
    "name",
    "users",
    "create",
    "read",
    "update",
    "delete",
    "status",
    "actions",
  ];
  readonly roles = [
    {
      name: "Admin",
      description: "Full access to tenant settings and billing",
      userCount: 3,
      crud: { create: true, read: true, update: true, delete: true },
      status: "active",
      builtIn: true,
    },
    {
      name: "Editor",
      description: "Create and update resources",
      userCount: 12,
      crud: { create: true, read: true, update: true, delete: false },
      status: "active",
      builtIn: true,
    },
    {
      name: "Viewer",
      description: "Read-only access",
      userCount: 41,
      crud: { create: false, read: true, update: false, delete: false },
      status: "active",
      builtIn: true,
    },
    {
      name: "Billing",
      description: "Invoices and payment methods only",
      userCount: 2,
      crud: { create: false, read: true, update: true, delete: false },
      status: "active",
      builtIn: false,
    },
  ];
}
