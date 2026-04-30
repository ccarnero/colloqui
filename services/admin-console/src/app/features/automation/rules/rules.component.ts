import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-rules",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Rules Engine</div>
        <div class="ws-subtitle">
          Declarative policies evaluated on events and API traffic
        </div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">+ New rule</button>
      </div>
    </div>

    <div class="section-card">
      <table mat-table [dataSource]="rules">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let r">{{ r.name }}</td>
        </ng-container>
        <ng-container matColumnDef="condition">
          <th mat-header-cell *matHeaderCellDef>Condition</th>
          <td mat-cell *matCellDef="let r">
            <code class="cond">{{ r.condition }}</code>
          </td>
        </ng-container>
        <ng-container matColumnDef="action">
          <th mat-header-cell *matHeaderCellDef>Action</th>
          <td mat-cell *matCellDef="let r">
            <code class="act">{{ r.action }}</code>
          </td>
        </ng-container>
        <ng-container matColumnDef="priority">
          <th mat-header-cell *matHeaderCellDef>Priority</th>
          <td mat-cell *matCellDef="let r">
            <span class="prio" [attr.data-p]="r.priority">{{
              r.priority
            }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <app-status-badge [status]="r.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let r">
            <button
              mat-icon-button
              type="button"
              aria-label="Edit rule"
              class="icon-btn"
            >
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              aria-label="Duplicate rule"
              class="icon-btn"
            >
              <mat-icon>content_copy</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </div>
  `,
  styles: `
    code.cond,
    code.act {
      display: inline-block;
      max-width: 280px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        monospace;
      font-size: 11px;
      padding: 6px 8px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: var(--radius2);
      color: var(--text2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .prio {
      display: inline-flex;
      min-width: 28px;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--bg3);
      border: 1px solid var(--border);
      color: var(--accent2);
    }
    .icon-btn {
      color: var(--text3);
    }
  `,
})
export class RulesComponent {
  readonly columns = [
    "name",
    "condition",
    "action",
    "priority",
    "status",
    "actions",
  ] as const;

  readonly rules = [
    {
      name: "Block risky regions",
      condition: 'request.geo.region in ["XX","YY"]',
      action: "deny(status=403)",
      priority: 10,
      status: "active",
    },
    {
      name: "Throttle burst traffic",
      condition: "rate_limit(api_key) > 5000/min",
      action: "throttle(delay=250ms)",
      priority: 20,
      status: "active",
    },
    {
      name: "Promote canary tenants",
      condition: 'tenant.tier == "enterprise"',
      action: "route(cluster=canary)",
      priority: 5,
      status: "draft",
    },
  ];
}
