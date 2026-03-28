import { Component, computed, inject, OnDestroy, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { TenantService } from "../../../core/services/tenant.service";
import { DashboardService } from "../../../core/services/dashboard.service";
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

    @if (dashboard.loading() && !dashboard.stats()) {
      <div class="cards-grid">
        @for (_ of skeletonCards; track $index) {
          <div class="card skeleton-card">
            <div class="skeleton-line short"></div>
            <div class="skeleton-line wide"></div>
            <div class="skeleton-line short"></div>
          </div>
        }
      </div>
    } @else {
      <div class="cards-grid">
        <div class="card">
          <div class="card-label">API Calls Today</div>
          <div class="card-value">{{ formattedRequests() }}</div>
          <div class="card-delta" [class]="requestsDeltaCss()">
            {{ requestsDeltaText() }}
          </div>
        </div>
        <div class="card">
          <div class="card-label">Active Sessions</div>
          <div class="card-value">{{ stats()?.activeSessions ?? 0 }}</div>
          <div class="card-delta">last 15 min</div>
        </div>
        <div class="card">
          <div class="card-label">Avg Response</div>
          <div class="card-value">{{ stats()?.avgResponseMs ?? 0 }}ms</div>
        </div>
        <div class="card">
          <div class="card-label">Error Rate</div>
          <div class="card-value">{{ stats()?.errorRate ?? 0 }}%</div>
          <div class="card-delta" [class]="errorDeltaCss()">
            {{ errorDeltaText() }}
          </div>
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
            <app-sparkline [data]="apiUsageData()" />
            <div class="chart-labels">
              @for (d of dayLabels(); track d) {
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
            <app-sparkline [data]="latencyData()" color="#22c55e" />
            <div class="chart-labels">
              @for (d of dayLabels(); track d) {
                <span>{{ d }}</span>
              }
            </div>
          </div>
        </div>
      </div>
    }
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
    .skeleton-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .skeleton-line {
      height: 14px;
      border-radius: 4px;
      background: var(--border);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .skeleton-line.short { width: 60%; }
    .skeleton-line.wide { width: 40%; height: 22px; }
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  protected readonly tenant = inject(TenantService);
  protected readonly dashboard = inject(DashboardService);

  protected readonly skeletonCards = Array.from({ length: 4 });

  protected readonly stats = this.dashboard.stats;

  protected readonly formattedRequests = computed(() => {
    const val = this.stats()?.requestsToday ?? 0;
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return String(val);
  });

  protected readonly requestsDeltaCss = computed(() => {
    const d = this.stats()?.requestsTodayDelta ?? 0;
    return d >= 0 ? "delta-up" : "delta-down";
  });

  protected readonly requestsDeltaText = computed(() => {
    const d = this.stats()?.requestsTodayDelta ?? 0;
    const arrow = d >= 0 ? "\u2191" : "\u2193";
    return `${arrow} ${Math.abs(d).toFixed(1)}%`;
  });

  protected readonly avgDeltaCss = computed(() => {
    const d = this.stats()?.avgResponseDelta ?? 0;
    return d <= 0 ? "delta-up" : "delta-down";
  });

  protected readonly avgDeltaText = computed(() => {
    const d = this.stats()?.avgResponseDelta ?? 0;
    if (d <= 80) return `\u2191 ${Math.abs(d)}ms faster`;
    return `\u2193 ${d}ms slower`;
  });

  protected readonly errorDeltaCss = computed(() => {
    const d = this.stats()?.errorRateDelta ?? 0;
    return d <= 0 ? "delta-up" : "delta-down";
  });

  protected readonly errorDeltaText = computed(() => {
    const d = this.stats()?.errorRateDelta ?? 0;
    const arrow = d <= 0 ? "\u2193" : "\u2191";
    return `${arrow} ${Math.abs(d).toFixed(2)}%`;
  });

  protected readonly apiUsageData = computed(() =>
    this.stats()?.dailyBreakdown.map((d) => d.requests) ?? [],
  );

  protected readonly latencyData = computed(() =>
    this.stats()?.dailyBreakdown.map((d) => d.avgLatencyMs) ?? [],
  );

  protected readonly dayLabels = computed(() => {
    const breakdown = this.stats()?.dailyBreakdown ?? [];
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return breakdown.map((d) => DAYS[new Date(d.date).getUTCDay()]);
  });

  ngOnInit(): void {
    this.dashboard.startPolling();
  }

  ngOnDestroy(): void {
    this.dashboard.stopPolling();
  }
}
