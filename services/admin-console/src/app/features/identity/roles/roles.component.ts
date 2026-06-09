import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { RoleService } from "../../../core/services/role.service";
import { AuthService } from "../../../core/services/auth.service";
import { TenantService } from "../../../core/services/tenant.service";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import {
  StatusBadgeComponent,
  type StatusBadgeColor,
} from "../../../shared/components/status-badge/status-badge.component";
import {
  RoleDialogComponent,
  type IRoleDialogData,
  type IRoleDialogResult,
} from "./role-dialog.component";
import type { ITenantRole } from "../../../core/models/user.model";

@Component({
  selector: "app-roles",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    StatusBadgeComponent,
    PageHeaderComponent,
  ],
  template: `
    <app-page-header
      title="Roles &amp; Permissions"
      subtitle="Define access for {{ tenant.currentTenant().name }}"
    >
      <ng-container slot="actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="openCreateDialog()"
        >
          + Create Role
        </button>
      </ng-container>
    </app-page-header>

    <div class="section-card">
      <table mat-table [dataSource]="roleService.roles()" class="full-width">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Role</th>
          <td mat-cell *matCellDef="let r">
            <strong>{{ r.name }}</strong>
            @if (r.is_system) {
              <span class="system-badge">System</span>
            }
            <div class="muted">{{ r.description }}</div>
          </td>
        </ng-container>
        <ng-container matColumnDef="users">
          <th mat-header-cell *matHeaderCellDef>Users</th>
          <td mat-cell *matCellDef="let r">{{ r.user_count ?? 0 }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <app-status-badge
              [status]="r.is_active ? 'active' : 'inactive'"
              [color]="r.is_active ? 'green' : 'gray'"
            />
          </td>
        </ng-container>
        <ng-container matColumnDef="permissions">
          <th mat-header-cell *matHeaderCellDef>Permissions</th>
          <td mat-cell *matCellDef="let r">
            @if (r.is_system) {
              <span class="perm-count all">All</span>
            } @else {
              <span class="perm-count">{{
                r.permissions?.length ?? 0
              }}</span>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let r">
            <button
              mat-icon-button
              type="button"
              aria-label="Edit role"
              (click)="openEditDialog(r)"
            >
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              color="warn"
              type="button"
              aria-label="Delete role"
              [disabled]="r.is_system"
              (click)="deleteRole(r)"
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
    .system-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--bg4);
      color: var(--text3);
      margin-left: 8px;
      vertical-align: middle;
    }
    .perm-count {
      font-weight: 600;
      font-size: 13px;
    }
    .perm-count.all {
      color: var(--accent);
    }
  `,
})
export class RolesComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  protected readonly roleService = inject(RoleService);
  protected readonly authService = inject(AuthService);
  protected readonly tenant = inject(TenantService);

  readonly displayedColumns = [
    "name",
    "users",
    "permissions",
    "status",
    "actions",
  ];

  ngOnInit(): void {
    this.roleService.loadRoles();
  }

  openCreateDialog(): void {
    const data: IRoleDialogData = {
      tenantId: this.authService.tenantId() ?? "",
    };
    const ref = this.dialog.open(RoleDialogComponent, {
      width: "640px",
      data,
    });

    ref.afterClosed().subscribe((result?: IRoleDialogResult) => {
      if (result?.saved) this.roleService.loadRoles();
    });
  }

  openEditDialog(role: ITenantRole): void {
    this.roleService.getRole(role.id).subscribe((full) => {
      const data: IRoleDialogData = {
        tenantId: this.authService.tenantId() ?? "",
        role: full,
      };
      const ref = this.dialog.open(RoleDialogComponent, {
        width: "640px",
        data,
      });

      ref.afterClosed().subscribe((result?: IRoleDialogResult) => {
        if (result?.saved) this.roleService.loadRoles();
      });
    });
  }

  deleteRole(role: ITenantRole): void {
    if (role.is_system) return;
    this.roleService.deleteRole(role.id);
  }
}
