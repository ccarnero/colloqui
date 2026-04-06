import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { TenantService } from "../../../core/services/tenant.service";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-groups",
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
        <div class="ws-title">Groups</div>
        <div class="ws-subtitle">
          Organize members in {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">
          + Create Group
        </button>
      </div>
    </div>

    <div class="section-card">
      <table mat-table [dataSource]="groups" class="full-width">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let g">
            <strong>{{ g.name }}</strong>
          </td>
        </ng-container>
        <ng-container matColumnDef="members">
          <th mat-header-cell *matHeaderCellDef>Members</th>
          <td mat-cell *matCellDef="let g">{{ g.memberCount }}</td>
        </ng-container>
        <ng-container matColumnDef="roles">
          <th mat-header-cell *matHeaderCellDef>Roles</th>
          <td mat-cell *matCellDef="let g">
            <span class="tags">
              @for (role of g.roles; track role) {
                <app-status-badge [status]="role" [color]="roleColor(role)" />
              }
            </span>
          </td>
        </ng-container>
        <ng-container matColumnDef="created">
          <th mat-header-cell *matHeaderCellDef>Created</th>
          <td mat-cell *matCellDef="let g" class="muted">{{ g.created }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let g">
            <button mat-icon-button type="button" aria-label="Edit group">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button color="warn" type="button" aria-label="Delete group">
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
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .muted {
      color: var(--text3);
      font-size: 13px;
    }
  `,
})
export class GroupsComponent {
  protected readonly tenant = inject(TenantService);
  readonly displayedColumns = [
    "name",
    "members",
    "roles",
    "created",
    "actions",
  ];
  readonly groups = [
    {
      name: "Engineering",
      memberCount: 24,
      roles: ["Editor", "Viewer"],
      created: "Jan 12, 2025",
    },
    {
      name: "Finance",
      memberCount: 6,
      roles: ["Viewer", "Billing"],
      created: "Feb 3, 2025",
    },
    {
      name: "Admins",
      memberCount: 3,
      roles: ["Admin"],
      created: "Dec 1, 2024",
    },
    {
      name: "Support",
      memberCount: 11,
      roles: ["Editor"],
      created: "Mar 8, 2025",
    },
  ];

  protected roleColor(
    role: string,
  ): "purple" | "blue" | "gray" | "green" | "yellow" | "red" {
    const map = new Map<string, "purple" | "blue" | "gray" | "green">([
      ["Admin", "purple"],
      ["Editor", "blue"],
      ["Viewer", "gray"],
      ["Billing", "green"],
    ]);
    return map.get(role) ?? "gray";
  }
}
