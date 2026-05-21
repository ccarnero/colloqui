import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { RoleService } from "../../../core/services/role.service";
import type {
  ITenantRole,
  ITenantRolePermission,
} from "../../../core/models/user.model";

const RESOURCES = [
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
  { key: "workflows", label: "Workflows" },
  { key: "adapters", label: "Adapters" },
  { key: "webhooks", label: "Webhooks" },
  { key: "audit", label: "Audit" },
  { key: "settings", label: "Settings" },
  { key: "api-keys", label: "API Keys" },
  { key: "analytics", label: "Analytics" },
] as const;

const ACTIONS = ["create", "read", "update", "delete"] as const;

interface IPermissionCell {
  resource: string;
  action: string;
  enabled: boolean;
}

export interface IRoleDialogData {
  tenantId: string;
  role?: ITenantRole;
}

export interface IRoleDialogResult {
  saved: boolean;
}

@Component({
  selector: "app-role-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? "Edit Role" : "Create Role" }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Role Name</mat-label>
        <input
          matInput
          [(ngModel)]="name"
          placeholder="e.g. editor, billing_admin"
          [disabled]="isSystemRole"
        />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description</mat-label>
        <textarea
          matInput
          [(ngModel)]="description"
          rows="2"
          placeholder="What can this role do?"
        ></textarea>
      </mat-form-field>

      <div class="perm-heading">Permissions</div>
      <div class="perm-grid">
        <div class="perm-header"></div>
        @for (action of actions; track action) {
          <div class="perm-header">{{ capitalize(action) }}</div>
        }

        @for (res of resources; track res.key) {
          <div class="perm-resource">{{ res.label }}</div>
          @for (action of actions; track action) {
            <div class="perm-cell">
              <mat-checkbox
                [checked]="hasPermission(res.key, action)"
                (change)="togglePermission(res.key, action)"
              />
            </div>
          }
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="saving() || !name.trim()"
        (click)="save()"
      >
        {{ saving() ? "Saving..." : isEdit ? "Update" : "Create" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: 520px;
    }
    .full-width {
      width: 100%;
    }
    .perm-heading {
      font-weight: 600;
      font-size: 14px;
      margin: 12px 0 8px;
    }
    .perm-grid {
      display: grid;
      grid-template-columns: 140px repeat(4, 1fr);
      gap: 2px 0;
      align-items: center;
    }
    .perm-header {
      font-size: 12px;
      font-weight: 600;
      color: var(--text3);
      text-align: center;
    }
    .perm-resource {
      font-size: 13px;
      font-weight: 500;
      padding: 4px 0;
    }
    .perm-cell {
      display: flex;
      justify-content: center;
    }
  `,
})
export class RoleDialogComponent implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly dialogRef =
    inject<MatDialogRef<RoleDialogComponent, IRoleDialogResult>>(MatDialogRef);
  private readonly data = inject<IRoleDialogData>(MAT_DIALOG_DATA);

  readonly resources = RESOURCES;
  readonly actions = ACTIONS;
  readonly saving = signal(false);

  name = "";
  description = "";
  isEdit = false;
  isSystemRole = false;

  private permissionSet = new Set<string>();

  ngOnInit(): void {
    const role = this.data.role;
    if (role) {
      this.isEdit = true;
      this.name = role.name;
      this.description = role.description ?? "";
      this.isSystemRole = role.is_system;
      if (role.permissions) {
        for (const p of role.permissions) {
          this.permissionSet.add(`${p.resource}:${p.action}`);
        }
      }
    }
  }

  hasPermission(resource: string, action: string): boolean {
    return this.permissionSet.has(`${resource}:${action}`);
  }

  togglePermission(resource: string, action: string): void {
    const key = `${resource}:${action}`;
    if (this.permissionSet.has(key)) {
      this.permissionSet.delete(key);
    } else {
      this.permissionSet.add(key);
    }
  }

  capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  save(): void {
    const permissions: ITenantRolePermission[] = [];
    for (const key of this.permissionSet) {
      const [resource, action] = key.split(":");
      permissions.push({ resource, action });
    }

    this.saving.set(true);

    if (this.isEdit && this.data.role) {
      this.roleService
        .patchRoleRequest(this.data.role.id, {
          name: this.isSystemRole ? undefined : this.name.trim(),
          description: this.description.trim(),
          permissions,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.dialogRef.close({ saved: true });
          },
          error: () => this.saving.set(false),
        });
    } else {
      this.roleService
        .createRoleRequest(
          this.data.tenantId,
          this.name.trim(),
          this.description.trim(),
          permissions,
        )
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.dialogRef.close({ saved: true });
          },
          error: () => this.saving.set(false),
        });
    }
  }
}
