import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { DashboardService } from "../../core/services/dashboard.service";
import { SparklineComponent } from "../../shared/components/sparkline/sparkline.component";
import { ProgressBarComponent } from "../../shared/components/progress-bar/progress-bar.component";
import { DatePipe } from "@angular/common";

@Component({
  selector: "app-right-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SparklineComponent, ProgressBarComponent, DatePipe],
  template: `
    <aside class="panel">
      <!-- Tenant Health -->
      <div class="rp-section">
        <div class="rp-title">Tenant Health</div>
        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Uptime</span>
            <span
              class="metric-value"
              [style.color]="uptimeColor()"
            >{{ stats()?.uptime ?? 0 }}%</span>
          </div>
          <div class="metric-sub">Current service health</div>
          <app-sparkline
            [data]="uptimeSparkline()"
            color="#22c55e"
          />
        </div>
        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Error Rate</span>
            <span
              class="metric-value"
              [style.color]="errorRateColor()"
            >{{ stats()?.errorRate ?? 0 }}%</span>
          </div>
          <div class="metric-sub">{{ errorRateSub() }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Avg Response</span>
            <span class="metric-value">
              {{ stats()?.avgResponseMs ?? 0 }}ms
            </span>
          </div>
          <div class="metric-sub">
            p95: {{ stats()?.p95ResponseMs ?? 0 }}ms
          </div>
        </div>
      </div>

      <!-- Quota Usage -->
      <div class="rp-section">
        <div class="rp-title">Quota Usage</div>
        <div class="quota-row">
          <div class="quota-header">
            <span class="quota-label">API Calls</span>
            <span class="quota-val">{{ apiCallsLabel() }}</span>
          </div>
          <app-progress-bar
            [value]="apiCallsPercent()"
            [color]="apiCallsPercent() > 80
              ? 'var(--yellow)' : 'var(--accent)'"
          />
        </div>
        <div class="quota-row">
          <div class="quota-header">
            <span class="quota-label">Storage</span>
            <span class="quota-val">{{ storageLabel() }}</span>
          </div>
          <app-progress-bar [value]="storagePercent()" />
        </div>
        <div class="quota-row">
          <div class="quota-header">
            <span class="quota-label">Webhooks</span>
            <span class="quota-val">{{ webhooksLabel() }}</span>
          </div>
          <app-progress-bar [value]="webhooksPercent()" />
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="rp-section">
        <div class="rp-title">Recent Activity</div>
        @for (item of recentActivity(); track item.timestamp) {
          <div class="activity-item">
            <div
              class="activity-dot"
              [style.background]="activityColor(item.type)"
            ></div>
            <div>
              <div class="activity-text">{{ item.text }}</div>
              <div class="activity-time">
                {{ item.timestamp | date: "short" }}
              </div>
            </div>
          </div>
        } @empty {
          <div class="activity-empty">No recent activity</div>
        }
      </div>
    </aside>
  `,
  styles: `
    .panel {
      padding: 16px;
      height: 100%;
    }
    .activity-empty {
      color: var(--text3);
      font-size: 12px;
      padding: 8px 0;
    }
  `,
})
export class RightPanelComponent {
  private readonly dashboard = inject(DashboardService);

  protected readonly stats = this.dashboard.stats;

  protected readonly recentActivity = computed(
    () => this.stats()?.recentActivity ?? [],
  );

  protected readonly uptimeColor = computed(() => {
    const u = this.stats()?.uptime ?? 100;
    if (u >= 99) return "var(--green)";
    if (u >= 95) return "var(--yellow)";
    return "var(--red)";
  });

  protected readonly uptimeSparkline = computed(() => {
    const breakdown = this.stats()?.dailyBreakdown ?? [];
    if (breakdown.length === 0) return [100];
    return breakdown.map(() => this.stats()?.uptime ?? 100);
  });

  protected readonly errorRateColor = computed(() => {
    const r = this.stats()?.errorRate ?? 0;
    if (r < 1) return "var(--green)";
    if (r < 5) return "var(--yellow)";
    return "var(--red)";
  });

  protected readonly errorRateSub = computed(() => {
    const d = this.stats()?.errorRateDelta ?? 0;
    if (d <= 0) return `\u2193 ${Math.abs(d).toFixed(2)}% from yesterday`;
    return `\u2191 ${d.toFixed(2)}% from yesterday`;
  });

  protected readonly apiCallsPercent = computed(() => {
    const q = this.stats()?.quotaApiCalls;
    if (!q || q.limit === 0) return 0;
    return Math.round((q.used / q.limit) * 100);
  });

  protected readonly apiCallsLabel = computed(() => {
    const q = this.stats()?.quotaApiCalls;
    if (!q) return "0 / 0";
    return `${formatCompact(q.used)} / ${formatCompact(q.limit)}`;
  });

  protected readonly storagePercent = computed(() => {
    const q = this.stats()?.quotaStorage;
    if (!q || q.limit === 0) return 0;
    return Math.round((q.used / q.limit) * 100);
  });

  protected readonly storageLabel = computed(() => {
    const q = this.stats()?.quotaStorage;
    if (!q) return "0 / 0 GB";
    return `${q.used} / ${q.limit} GB`;
  });

  protected readonly webhooksPercent = computed(() => {
    const q = this.stats()?.quotaWebhooks;
    if (!q || q.limit === 0) return 0;
    return Math.round((q.used / q.limit) * 100);
  });

  protected readonly webhooksLabel = computed(() => {
    const q = this.stats()?.quotaWebhooks;
    if (!q) return "0 / 0";
    return `${q.used} / ${q.limit}`;
  });

  protected activityColor(type: string): string {
    switch (type) {
      case "gateway.request":
        return "var(--accent)";
      case "user.created":
        return "var(--green)";
      case "auth.failed":
        return "var(--red)";
      default:
        return "var(--purple)";
    }
  }
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
