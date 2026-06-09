import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatTableModule } from "@angular/material/table";
import { TenantService } from "../../../core/services/tenant.service";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { SparklineComponent } from "../../../shared/components/sparkline/sparkline.component";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-analytics",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTableModule, PageHeaderComponent, SparklineComponent, StatusBadgeComponent],
  template: `
    <app-page-header title="Analytics" subtitle="Track usage and performance metrics">
      <ng-container slot="actions">
        <select class="btn btn-secondary btn-sm" aria-label="Date range">
          <option>Last 7 days</option>
          <option>Last 30 days</option>
          <option>Last 90 days</option>
        </select>
      </ng-container>
    </app-page-header>

    <div class="cards-grid">
      <div class="card">
        <div class="card-label">Page Views</div>
        <div class="card-value">1.24M</div>
        <div class="card-delta delta-up">&#8593; 18.4%</div>
      </div>
      <div class="card">
        <div class="card-label">Unique Sessions</div>
        <div class="card-value">48.2K</div>
        <div class="card-delta delta-up">&#8593; 6.1%</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Session</div>
        <div class="card-value">4m 32s</div>
        <div class="card-delta delta-up">&#8593; 12s</div>
      </div>
      <div class="card">
        <div class="card-label">Bounce Rate</div>
        <div class="card-value">28.4%</div>
        <div class="card-delta delta-down">&#8595; 2.1%</div>
      </div>
    </div>

    <div class="section-card" style="margin-bottom: 16px">
      <div class="section-card-header">
        <div class="section-card-title">API Call Volume</div>
        <span class="badge badge-green">Live</span>
      </div>
      <div class="section-card-body">
        <app-sparkline [data]="apiVolumeData" />
      </div>
    </div>

    <div class="two-col">
      <div class="section-card">
        <div class="section-card-header">
          <div class="section-card-title">Top Endpoints</div>
        </div>
        <table mat-table [dataSource]="topEndpoints" class="full-width">
          <ng-container matColumnDef="endpoint">
            <th mat-header-cell *matHeaderCellDef>Endpoint</th>
            <td mat-cell *matCellDef="let e">{{ e.endpoint }}</td>
          </ng-container>
          <ng-container matColumnDef="calls">
            <th mat-header-cell *matHeaderCellDef>Calls</th>
            <td mat-cell *matCellDef="let e">{{ e.calls }}</td>
          </ng-container>
          <ng-container matColumnDef="avg">
            <th mat-header-cell *matHeaderCellDef>Avg ms</th>
            <td mat-cell *matCellDef="let e">{{ e.avg }}</td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="endpointColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: endpointColumns"></tr>
        </table>
      </div>
      <div class="section-card">
        <div class="section-card-header">
          <div class="section-card-title">Error Breakdown</div>
        </div>
        <table mat-table [dataSource]="errorBreakdown" class="full-width">
          <ng-container matColumnDef="code">
            <th mat-header-cell *matHeaderCellDef>Code</th>
            <td mat-cell *matCellDef="let e">
              <app-status-badge [status]="e.code" [color]="e.color" />
              {{ e.label }}
            </td>
          </ng-container>
          <ng-container matColumnDef="count">
            <th mat-header-cell *matHeaderCellDef>Count</th>
            <td mat-cell *matCellDef="let e">{{ e.count }}</td>
          </ng-container>
          <ng-container matColumnDef="rate">
            <th mat-header-cell *matHeaderCellDef>Rate</th>
            <td mat-cell *matCellDef="let e">{{ e.rate }}</td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="errorColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: errorColumns"></tr>
        </table>
      </div>
    </div>
  `,
  styles: `
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 768px) {
      .two-col {
        grid-template-columns: 1fr;
      }
    }
    .full-width {
      width: 100%;
    }
  `,
})
export class AnalyticsComponent {
  protected readonly tenant = inject(TenantService);
  readonly apiVolumeData = [
    12000, 18000, 15000, 22000, 19000, 28000, 24000, 31000, 27000, 35000, 30000,
    38000, 34000, 42000,
  ];
  readonly topEndpoints = [
    { endpoint: "/api/users", calls: "24.1K", avg: 42 },
    { endpoint: "/api/auth/token", calls: "18.7K", avg: 28 },
    { endpoint: "/api/data/query", calls: "12.3K", avg: 180 },
    { endpoint: "/api/webhooks", calls: "8.9K", avg: 55 },
    { endpoint: "/api/reports", calls: "4.2K", avg: 320 },
  ];
  readonly errorBreakdown = [
    {
      code: "400",
      label: "Bad Request",
      count: 342,
      rate: "0.08%",
      color: "yellow" as const,
    },
    {
      code: "401",
      label: "Unauthorized",
      count: 128,
      rate: "0.03%",
      color: "red" as const,
    },
    {
      code: "404",
      label: "Not Found",
      count: 89,
      rate: "0.02%",
      color: "gray" as const,
    },
    {
      code: "429",
      label: "Rate Limited",
      count: 45,
      rate: "0.01%",
      color: "yellow" as const,
    },
    {
      code: "500",
      label: "Server Error",
      count: 12,
      rate: "0.003%",
      color: "red" as const,
    },
  ];
  readonly endpointColumns = ["endpoint", "calls", "avg"];
  readonly errorColumns = ["code", "count", "rate"];
}
