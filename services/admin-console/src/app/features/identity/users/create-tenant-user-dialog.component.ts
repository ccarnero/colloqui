import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type { ITenantRole } from "../../../core/models/user.model";
import { RoleService } from "../../../core/services/role.service";
import { TenantUsersService } from "../../../core/services/tenant-users.service";

interface IDialogData {
  tenantId: string | null;
}

@Component({
  selector: "app-create-tenant-user-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <div class="dialog-header">
      <div>
        <div class="dialog-title">Add User</div>
        <div class="dialog-subtitle">Create a new tenant user</div>
      </div>
      <button
        type="button"
        class="btn btn-icon btn-secondary"
        aria-label="Close"
        (click)="dialogRef.close()"
      >
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-dialog-content>
      <div class="form-body">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Email</mat-label>
          <input
            matInput
            type="email"
            [ngModel]="email()"
            (ngModelChange)="email.set($event)"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Display Name</mat-label>
          <input
            matInput
            [ngModel]="displayName()"
            (ngModelChange)="displayName.set($event)"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Password</mat-label>
          <input
            matInput
            type="password"
            [ngModel]="password()"
            (ngModelChange)="password.set($event)"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Role</mat-label>
          <mat-select
            [ngModel]="selectedRoleId()"
            (ngModelChange)="selectedRoleId.set($event)"
          >
            @for (r of availableRoles(); track r.id) {
              <mat-option [value]="r.id">{{ r.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (errorMessage()) {
          <div class="error-msg">{{ errorMessage() }}</div>
        }
      </div>
    </mat-dialog-content>

    <div class="dialog-footer">
      <button
        type="button"
        class="btn btn-secondary"
        (click)="dialogRef.close()"
      >
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
        [disabled]="submitting()"
        (click)="submit()"
      >
        Create
      </button>
    </div>
  `,
  styles: `
    .dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 16px 24px 10px;
      gap: 12px;
    }
    .dialog-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }
    .dialog-subtitle {
      font-size: 11px;
      color: var(--text3);
      margin-top: 2px;
    }
    .dialog-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 24px 16px;
      border-top: 1px solid var(--border);
    }
    .form-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .full-width {
      width: 100%;
    }
    .error-msg {
      color: var(--red);
      font-size: 12px;
      margin-top: 4px;
    }
  `,
})
export class CreateTenantUserDialogComponent implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly tenantUsers = inject(TenantUsersService);
  readonly dialogRef = inject(MatDialogRef<CreateTenantUserDialogComponent>);
  readonly data = inject<IDialogData>(MAT_DIALOG_DATA);

  readonly availableRoles = signal<ITenantRole[]>([]);
  readonly email = signal("");
  readonly displayName = signal("");
  readonly password = signal("");
  readonly selectedRoleId = signal("");
  readonly submitting = signal(false);
  readonly errorMessage = signal("");

  ngOnInit(): void {
    this.roleService.listRoles$().subscribe({
      next: (roles) => {
        this.availableRoles.set(roles);
        if (roles.length > 0) {
          this.selectedRoleId.set(roles[0].id);
        }
      },
    });
  }

  submit(): void {
    this.submitting.set(true);
    this.errorMessage.set("");

    this.tenantUsers
      .createUser({
        tenant_id: this.data.tenantId,
        email: this.email(),
        password: this.password(),
        role_id: this.selectedRoleId(),
        display_name: this.displayName() || undefined,
      })
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.dialogRef.close(result);
        },
        error: (err) => {
          this.submitting.set(false);
          const msg = err?.error?.message ?? "Failed to create user";
          this.errorMessage.set(msg);
        },
      });
  }
}
