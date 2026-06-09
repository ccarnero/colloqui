import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { TenantService } from "../../../core/services/tenant.service";
import { DashboardService } from "../../../core/services/dashboard.service";
import { SparklineComponent } from "../../../shared/components/sparkline/sparkline.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import { formatCompact } from "../../../shared/utils/format-compact";

@Component({
  selector: "app-dashboard",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, SparklineComponent, PageHeaderComponent, KpiCardComponent],
  template: `
    <app-page-header
      title="Dashboard"
      [subtitle]="tenant.currentTenant().name"
    >
      <ng-container slot="actions">
        <button class="btn btn-secondary btn-sm" type="button">
          Export Report
        </button>
      </ng-container>
    </app-page-header>

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
        <app-kpi-card
          label="API Calls Today"
          [value]="formattedRequests()"
          [sub]="requestsDeltaText()"
          [trend]="requestsTrend()"
        />
        <app-kpi-card
          label="Active Sessions"
          [value]="stats()?.activeSessions ?? 0"
          sub="last 15 min"
        />
        <app-kpi-card
          label="Avg Response"
          [value]="(stats()?.avgResponseMs ?? 0) + 'ms'"
        />
        <app-kpi-card
          label="Error Rate"
          [value]="(stats()?.errorRate ?? 0) + '%'"
          [sub]="errorDeltaText()"
          [trend]="errorTrend()"
          [trendIsGood]="false"
        />
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
    @media (max-width: 768px) {
      .charts-grid { grid-template-columns: 1fr; }
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
    return formatCompact(this.stats()?.requestsToday ?? 0);
  });

  protected readonly requestsTrend = computed(() => {
    const d = this.stats()?.requestsTodayDelta ?? 0;
    return d > 0 ? "up" : d < 0 ? "down" : "flat";
  });

  protected readonly errorTrend = computed(() => {
    const d = this.stats()?.errorRateDelta ?? 0;
    return d > 0 ? "up" : d < 0 ? "down" : "flat";
  });

  protected readonly requestsDeltaText = computed(() => {
    const d = this.stats()?.requestsTodayDelta ?? 0;
    return `${Math.abs(d).toFixed(1)}%`;
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

  protected readonly errorDeltaText = computed(() => {
    const d = this.stats()?.errorRateDelta ?? 0;
    return `${Math.abs(d).toFixed(2)}%`;
  });

  protected readonly apiUsageData = computed(
    () => this.stats()?.dailyBreakdown.map((d) => d.requests) ?? [],
  );

  protected readonly latencyData = computed(
    () => this.stats()?.dailyBreakdown.map((d) => d.avgLatencyMs) ?? [],
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
