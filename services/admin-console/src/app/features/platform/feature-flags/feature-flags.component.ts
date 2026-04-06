import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatTableModule } from "@angular/material/table";
import { MatButtonModule } from "@angular/material/button";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { MatIconModule } from "@angular/material/icon";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import { ProgressBarComponent } from "../../../shared/components/progress-bar/progress-bar.component";

@Component({
  selector: "app-feature-flags",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatIconModule,
    StatusBadgeComponent,
    ProgressBarComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Feature Flags</div>
        <div class="ws-subtitle">Control feature rollouts across environments</div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm">+ New Flag</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="flags">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Flag</th>
          <td mat-cell *matCellDef="let f">
            <div style="font-family:monospace;font-weight:600">{{ f.name }}</div>
            <div style="font-size:11px;color:var(--text3)">{{ f.description }}</div>
          </td>
        </ng-container>
        <ng-container matColumnDef="env">
          <th mat-header-cell *matHeaderCellDef>Environment</th>
          <td mat-cell *matCellDef="let f"><app-status-badge [status]="f.env" [color]="f.env === 'production' ? 'green' : f.env === 'staging' ? 'yellow' : 'gray'" /></td>
        </ng-container>
        <ng-container matColumnDef="rollout">
          <th mat-header-cell *matHeaderCellDef>Rollout</th>
          <td mat-cell *matCellDef="let f" style="min-width:120px">
            <div style="font-size:12px;margin-bottom:4px">{{ f.rollout }}%</div>
            <app-progress-bar [value]="f.rollout" />
          </td>
        </ng-container>
        <ng-container matColumnDef="enabled">
          <th mat-header-cell *matHeaderCellDef>Enabled</th>
          <td mat-cell *matCellDef="let f"><mat-slide-toggle [checked]="f.enabled" /></td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let f">
            <button mat-icon-button><mat-icon>edit</mat-icon></button>
            <button mat-icon-button color="warn"><mat-icon>delete</mat-icon></button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class FeatureFlagsComponent {
  readonly cols = ["name", "env", "rollout", "enabled", "actions"];
  readonly flags = [
    {
      id: 1,
      name: "new_dashboard_v2",
      description: "Redesigned analytics dashboard",
      enabled: true,
      rollout: 100,
      env: "production",
    },
    {
      id: 2,
      name: "ai_suggestions",
      description: "AI-powered content suggestions",
      enabled: true,
      rollout: 25,
      env: "production",
    },
    {
      id: 3,
      name: "bulk_import_v3",
      description: "New bulk import with validation",
      enabled: false,
      rollout: 0,
      env: "staging",
    },
    {
      id: 4,
      name: "advanced_reporting",
      description: "Custom report builder",
      enabled: true,
      rollout: 50,
      env: "production",
    },
    {
      id: 5,
      name: "sso_google_workspace",
      description: "Google Workspace SSO integration",
      enabled: true,
      rollout: 100,
      env: "production",
    },
    {
      id: 6,
      name: "dark_mode_beta",
      description: "Dark mode UI theme",
      enabled: false,
      rollout: 0,
      env: "development",
    },
    {
      id: 7,
      name: "webhook_retry_v2",
      description: "Improved webhook retry logic",
      enabled: true,
      rollout: 75,
      env: "production",
    },
  ];
}
