import { Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { TenantService } from "../../../core/services/tenant.service";
import { SparklineComponent } from "../../../shared/components/sparkline/sparkline.component";

@Component({
  selector: "app-dashboard",
  imports: [
    MatButtonModule,
    SparklineComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Dashboard</div>
        <div class="ws-subtitle">
          {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-secondary btn-sm" type="button">
          Export Report
        </button>
      </div>
    </div>

    <div class="cards-grid">
      <div class="card">
        <div class="card-label">API Calls Today</div>
        <div class="card-value">84.2K</div>
        <div class="card-delta delta-up">&#8593; 3.1%</div>
      </div>
      <div class="card">
        <div class="card-label">Active Sessions</div>
        <div class="card-value">142</div>
        <div class="card-delta delta-down">&#8595; 5 from peak</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Response</div>
        <div class="card-value">48ms</div>
        <div class="card-delta delta-up">&#8593; 2ms faster</div>
      </div>
      <div class="card">
        <div class="card-label">Error Rate</div>
        <div class="card-value">0.12%</div>
        <div class="card-delta delta-up">&#8595; 0.03%</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">API Usage</div>
            <div class="section-card-sub">Last 7 days</div>
          </div>
          <span class="badge badge-green">Normal</span>
        </div>
        <div class="section-card-body">
          <app-sparkline [data]="apiUsageData" />
          <div class="chart-labels">
            @for (d of days; track d) {
              <span>{{ d }}</span>
            }
          </div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Request Latency</div>
            <div class="section-card-sub">Last 7 days</div>
          </div>
        </div>
        <div class="section-card-body">
          <app-sparkline [data]="latencyData" color="#22c55e" />
          <div class="chart-labels">
            @for (d of days; track d) {
              <span>{{ d }}</span>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .chart-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 11px;
      color: var(--text3);
    }
  `,
})
export class DashboardComponent {
  protected readonly tenant = inject(TenantService);
  readonly apiUsageData = [
    42000, 55000, 48000, 71000, 63000, 84200, 79000,
  ];
  readonly latencyData = [52, 48, 55, 42, 50, 48, 45];
  readonly days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}
