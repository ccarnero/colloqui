import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import type { IUser } from "../../../core/models";
import { AuthService } from "../../../core/services/auth.service";
import { TenantService } from "../../../core/services/tenant.service";
import { TenantUsersService } from "../../../core/services/tenant-users.service";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../../shared/components/inventory-table/inventory-table.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import { CreateTenantUserDialogComponent } from "./create-tenant-user-dialog.component";
import {
  type IUserDetailDialogResult,
  UserDetailDialogComponent,
} from "./user-detail-dialog.component";

/**
 * Users screen, restyled onto the inventory-table primitive per design
 * `Rediseño Terminal.dc.html` lines 658-681 (columns Email/Name/Role/
 * Created, single "Deactivate user" row action, "Add user" header
 * action). T01 finding 1: `IUser` has no status/last-active field — those
 * columns are intentionally not rendered (they don't exist), and there is
 * no "edit" action (never existed, T01 finding 6).
 */
@Component({
  selector: "app-users",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    InventoryTableComponent,
    PageHeaderComponent,
  ],
  template: `
    <app-page-header
      title="Users"
      [subtitle]="users().length + ' members in ' + tenant.currentTenant().name"
    >
      <ng-container slot="actions">
        @if (authService.hasPermission("users:create")) {
          <button
            class="btn btn-primary btn-sm"
            type="button"
            (click)="openCreateDialog()"
          >
            + Add User
          </button>
        }
      </ng-container>
    </app-page-header>

    @if (loading()) {
      <div class="table-wrap" style="padding: 32px; text-align: center">
        <mat-spinner diameter="32" />
        <p style="margin-top: 12px; color: var(--rd-text-3)">
          Loading users...
        </p>
      </div>
    } @else if (error()) {
      <div class="alert alert-error">
        <mat-icon>error_outline</mat-icon>
        <div>
          <strong>Failed to load users</strong>
          <p style="margin-top: 4px">{{ error() }}</p>
          <button
            class="btn btn-secondary btn-sm"
            style="margin-top: 8px"
            (click)="loadUsers()"
          >
            Retry
          </button>
        </div>
      </div>
    } @else {
      <app-inventory-table
        [columns]="userColumns"
        [rows]="users()"
        ariaLabel="Tenant users"
        emptyMessage="No users yet. Invite users to collaborate on this tenant."
        (rowClick)="onUserRowClick($event)"
      />
    }
  `,
  styles: `
    app-inventory-table {
      display: block;
    }
  `,
})
export class UsersComponent implements OnInit {
  private readonly tenantUsers = inject(TenantUsersService);
  private readonly dialog = inject(MatDialog);
  private readonly utcDate = new UtcDatePipe();
  protected readonly authService = inject(AuthService);
  protected readonly tenant = inject(TenantService);

  readonly users = signal<IUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /**
   * Inventory-table columns for the users list. Only real `IUser` fields
   * are mapped (T01 finding 1) — no status/last-active columns exist.
   * Role is rendered as plain text: the primitive's "status-badge" column
   * type only exposes a `health` accessor (ok/warn/error/idle) for the
   * "dot" variant, not an arbitrary per-role color, so it cannot reproduce
   * the design's `roleColor`/`roleBg` pill without extending the shared
   * primitive, which is out of scope for T02 (ONLY
   * features/identity/users/ may change).
   */
  readonly userColumns: InventoryTableColumn<IUser>[] = [
    {
      key: "email",
      header: "Email",
      type: "mono",
      value: (u) => u.email,
      width: "2fr",
    },
    {
      key: "name",
      header: "Name",
      type: "text",
      value: (u) => u.display_name || "—",
      width: "1.4fr",
    },
    {
      key: "role",
      header: "Role",
      type: "text",
      value: (u) => this.formatRole(u.role),
      width: "1.1fr",
    },
    {
      key: "created",
      header: "Created",
      type: "mono",
      value: (u) => this.formatCreatedAt(u.created_at),
      width: "1fr",
    },
  ];

  ngOnInit(): void {
    this.loadUsers();
  }

  openCreateDialog(): void {
    // Verbose logging: existing invite flow unchanged, T01 finding 1.
    console.debug("[UsersComponent] opening create-user dialog");
    const ref = this.dialog.open(CreateTenantUserDialogComponent, {
      width: "480px",
      data: { tenantId: this.authService.tenantId() },
    });

    ref.afterClosed().subscribe((created: IUser | undefined) => {
      if (created) {
        console.debug("[UsersComponent] user created, reloading list", {
          userId: created.id,
        });
        this.loadUsers();
      } else {
        console.debug(
          "[UsersComponent] create-user dialog closed without creating"
        );
      }
    });
  }

  /**
   * Design (Rediseño Terminal.dc.html lines 658-681) shows "Deactivate
   * user" as a per-row icon button, but the shared `app-inventory-table`
   * primitive has no action-column type and is out of scope to extend for
   * T02 (ONLY features/identity/users/ may change). Smallest faithful
   * substitute: row click opens a row-detail dialog
   * (`UserDetailDialogComponent`, styled after the shared
   * `app-detail-dialog` primitive) that surfaces the same Deactivate
   * action, gated the same way (`users:delete`).
   */
  onUserRowClick(user: IUser): void {
    console.debug("[UsersComponent] user row clicked, opening detail dialog", {
      userId: user.id,
    });
    const canDeactivate = this.authService.hasPermission("users:delete");
    const ref = this.dialog.open(UserDetailDialogComponent, {
      width: "420px",
      panelClass: "rd-dialog-panel",
      data: {
        user,
        canDeactivate,
        formatRole: (role: string) => this.formatRole(role),
        formatCreatedAt: (createdAt: string) => this.formatCreatedAt(createdAt),
      },
    });

    ref
      .afterClosed()
      .subscribe((result: IUserDetailDialogResult | undefined) => {
        if (result?.action === "deactivate") {
          this.deactivateUser(result.userId);
        } else {
          console.debug(
            "[UsersComponent] user detail dialog closed, no action",
            {
              userId: user.id,
            }
          );
        }
      });
  }

  deactivateUser(id: string): void {
    console.debug("[UsersComponent] deactivating user", { userId: id });
    this.tenantUsers.deleteUser(id).subscribe({
      next: () => {
        console.debug("[UsersComponent] user deactivated, reloading list", {
          userId: id,
        });
        this.loadUsers();
      },
      error: (err) => {
        console.error("[UsersComponent] failed to deactivate user", {
          userId: id,
          error: err,
        });
      },
    });
  }

  formatRole(role: string): string {
    return role
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  private formatCreatedAt(createdAt: string): string {
    return this.utcDate.transform(createdAt, "mediumDate") ?? "—";
  }

  protected loadUsers(): void {
    this.loading.set(true);
    this.error.set(null);
    console.debug("[UsersComponent] loading users");
    this.tenantUsers.listUsers().subscribe({
      next: (data) => {
        this.users.set(data);
        this.loading.set(false);
        console.debug("[UsersComponent] users loaded", { count: data.length });
      },
      error: (err) => {
        this.error.set(err?.message ?? "Failed to load users");
        this.loading.set(false);
        console.error("[UsersComponent] failed to load users", {
          error: err,
        });
      },
    });
  }
}
