import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatTabsModule } from "@angular/material/tabs";
import { MatPaginatorModule } from "@angular/material/paginator";
import { MatDialogModule, MatDialog } from "@angular/material/dialog";
import { AuthService } from "../../../core/services/auth.service";
import { TenantService } from "../../../core/services/tenant.service";
import {
  StatusBadgeComponent,
  type StatusBadgeColor,
} from "../../../shared/components/status-badge/status-badge.component";
import { CreateTenantUserDialogComponent } from "./create-tenant-user-dialog.component";
import { TenantUsersService } from "../../../core/services/tenant-users.service";
import type { IUser } from "../../../core/models";

@Component({
  selector: "app-users",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatPaginatorModule,
    MatDialogModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Users</div>
        <div class="ws-subtitle">
          {{ users().length }} members in
          {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        @if (authService.hasPermission("users:create")) {
          <button
            class="btn btn-primary btn-sm"
            type="button"
            (click)="openCreateDialog()"
          >
            + Add User
          </button>
        }
      </div>
    </div>

    <div class="table-wrap" style="margin-top: 16px">
      <table mat-table [dataSource]="users()">
        <ng-container matColumnDef="email">
          <th mat-header-cell *matHeaderCellDef>Email</th>
          <td mat-cell *matCellDef="let u">{{ u.email }}</td>
        </ng-container>
        <ng-container matColumnDef="display_name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let u">
            {{ u.display_name || "—" }}
          </td>
        </ng-container>
        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>Role</th>
          <td mat-cell *matCellDef="let u">
            <app-status-badge
              [status]="formatRole(u.role)"
              [color]="roleColor(u.role)"
            />
          </td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Created</th>
          <td mat-cell *matCellDef="let u" style="color: var(--text3)">
            {{ u.created_at | date: "mediumDate" }}
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let u">
            @if (authService.hasPermission("users:delete")) {
              <button
                mat-icon-button
                color="warn"
                type="button"
                aria-label="Deactivate user"
                (click)="deactivateUser(u.id)"
              >
                <mat-icon>person_off</mat-icon>
              </button>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
      </table>
      <mat-paginator
        [length]="users().length"
        [pageSize]="10"
        [pageSizeOptions]="[10, 25, 50]"
        showFirstLastButtons
      />
    </div>
  `,
})
export class UsersComponent implements OnInit {
  private readonly tenantUsers = inject(TenantUsersService);
  private readonly dialog = inject(MatDialog);
  protected readonly authService = inject(AuthService);
  protected readonly tenant = inject(TenantService);

  readonly displayedColumns = [
    "email",
    "display_name",
    "role",
    "created_at",
    "actions",
  ];

  readonly users = signal<IUser[]>([]);

  ngOnInit(): void {
    this.loadUsers();
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(CreateTenantUserDialogComponent, {
      width: "480px",
      data: { tenantId: this.authService.tenantId() },
    });

    ref.afterClosed().subscribe((created: IUser | undefined) => {
      if (created) {
        this.loadUsers();
      }
    });
  }

  deactivateUser(id: string): void {
    this.tenantUsers.deleteUser(id).subscribe({
      next: () => this.loadUsers(),
    });
  }

  formatRole(role: string): string {
    return role
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  roleColor(role: string): StatusBadgeColor {
    if (role === "tenant_admin") return "purple";
    return "blue";
  }

  private loadUsers(): void {
    this.tenantUsers.listUsers().subscribe({
      next: (data) => this.users.set(data),
    });
  }
}
