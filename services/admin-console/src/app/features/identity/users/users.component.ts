import { Component, inject, signal, type OnInit } from "@angular/core";
import { DatePipe } from "@angular/common";
import { HttpClient } from "@angular/common/http";
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
import { environment } from "../../../../environments/environment";
import { CreateTenantUserDialogComponent } from "./create-tenant-user-dialog.component";
import type { IUser } from "../../../core/models";

@Component({
  selector: "app-users",
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
        @if (authService.userRole() === "tenant_admin") {
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
            @if (authService.userRole() === "tenant_admin") {
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
  private readonly http = inject(HttpClient);
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
    this.http
      .delete(`${environment.apiUrl}/auth/tenant-users/${id}`)
      .subscribe({
        next: () => this.loadUsers(),
      });
  }

  formatRole(role: string): string {
    return role
      .replace("tenant_", "")
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  roleColor(role: string): StatusBadgeColor {
    if (role === "tenant_admin") return "purple";
    if (role === "tenant_editor") return "blue";
    return "gray";
  }

  private loadUsers(): void {
    this.http
      .get<IUser[]>(`${environment.apiUrl}/auth/tenant-users`)
      .subscribe({
        next: (data) => this.users.set(data),
      });
  }
}
