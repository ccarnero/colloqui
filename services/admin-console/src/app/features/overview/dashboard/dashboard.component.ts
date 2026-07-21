import { formatDate } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { Router } from "@angular/router";
import {
  DashboardService,
  type IDashboardActivity,
} from "../../../core/services/dashboard.service";
import {
  type ITopWorkflowEntry,
  ProcessesMetricsService,
} from "../../../core/services/metrics/processes-metrics.service";
import { TenantService } from "../../../core/services/tenant.service";
import {
  ActivityFeedComponent,
  type ActivityTone,
  type IActivityEntry,
} from "../../../shared/components/activity-feed/activity-feed.component";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../../shared/components/inventory-table/inventory-table.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { SparklineComponent } from "../../../shared/components/sparkline/sparkline.component";
import { formatCompact } from "../../../shared/utils/format-compact";

@Component({
  selector: "app-dashboard",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    SparklineComponent,
    PageHeaderComponent,
    KpiCardComponent,
    ActivityFeedComponent,
    InventoryTableComponent,
  ],
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
      <!-- Metric strip — design: Rediseño Terminal.dc.html lines 102-123.
           Sparkline slots are attached only where a real daily series
           exists in IDashboardStats.dailyBreakdown (T01 finding 5):
           API calls today <- dailyBreakdown[].requests,
           Avg response <- dailyBreakdown[].avgLatencyMs.
           Active sessions / Error rate have no daily series, so no
           sparkline is rendered for them (nothing invented). -->
      <div class="cards-grid">
        <app-kpi-card
          label="API calls today"
          [value]="formattedRequests()"
          [sub]="'vs yesterday'"
          [trend]="requestsTrend()"
          [trendLabel]="requestsDeltaText()"
          [sparklineData]="apiUsageData()"
        />
        <app-kpi-card
          label="Active sessions"
          [value]="stats()?.activeSessions ?? 0"
          sub="last 15 min"
        />
        <app-kpi-card
          label="Avg response"
          [value]="(stats()?.avgResponseMs ?? 0) + 'ms'"
          sub="p50 · 7 days"
          [trend]="avgResponseTrend()"
          [trendLabel]="avgResponseDeltaText()"
          [trendIsGood]="false"
          [sparklineData]="latencyData()"
        />
        <app-kpi-card
          label="Error rate"
          [value]="(stats()?.errorRate ?? 0) + '%'"
          [sub]="'vs yesterday'"
          [trend]="errorTrend()"
          [trendLabel]="errorDeltaText()"
          [trendIsGood]="false"
        />
      </div>

      <!-- API-usage chart + Activity row — design: lines 124-146.
           No needs-attention panel here (human sign-off, SPEC decision 2
           amendment 2026-07-21): that panel belongs to Channels (L2). -->
      <div class="charts-grid">
        <div class="section-card">
          <div class="section-card-header">
            <div>
              <div class="section-card-title">API usage · 7 days</div>
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
              <div class="section-card-title">Actividad</div>
            </div>
          </div>
          <div class="section-card-body">
            <app-activity-feed
              [entries]="activityEntries()"
              emptyText="No recent activity"
            />
          </div>
        </div>
      </div>

      <!-- Recent workflows table — design: lines 147-153.
           AMENDED decision 4 (human sign-off, T01 finding 6): only Name and
           Executions map to real data (ProcessesMetricsService.topWorkflows,
           processes-metrics.service.ts:11-16). Trigger/p95/Estado have no
           existing data source and are NOT rendered; the hard-coded
           successRate (line 68 of that service) is never surfaced here.
           No per-workflow time series exists either, so no sparkline
           column is added (nothing invented). -->
      <div class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Recent workflows</div>
          </div>
        </div>
        <app-inventory-table
          [columns]="workflowColumns"
          [rows]="topWorkflows()"
          ariaLabel="Recent workflows"
          emptyMessage="No recent workflows"
          (rowClick)="onWorkflowRowClick($event)"
        />
      </div>
    }
  `,
  styles: `
    .charts-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
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
      color: var(--rd-text-3);
    }
    .skeleton-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .skeleton-line {
      height: 14px;
      border-radius: 4px;
      background: var(--rd-line);
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
  protected readonly processes = inject(ProcessesMetricsService);
  private readonly router = inject(Router);

  protected readonly skeletonCards = Array.from({ length: 4 });

  protected readonly stats = this.dashboard.stats;

  protected readonly topWorkflows = computed(() => {
    const workflows = this.processes.topWorkflows();
    if (workflows.length === 0) {
      console.debug(
        "[DashboardComponent] topWorkflows empty, recent-workflows table will render its empty state"
      );
    }
    return workflows;
  });

  /**
   * "Recent workflows" columns — design: Rediseño Terminal.dc.html
   * lines 147-153 (Nombre / Trigger / Ejecuciones / p95 / Estado).
   * AMENDED decision 4 (human sign-off, T01 finding 6): only Name and
   * Executions have a real data source in `ITopWorkflowEntry`
   * (`name`, `runs7d`); Trigger/p95/Estado are dropped, and `successRate`
   * (hard-coded to `1` in `processes-metrics.service.ts:68`) is never
   * rendered as if it were real.
   */
  protected readonly workflowColumns: InventoryTableColumn<ITopWorkflowEntry>[] =
    [
      { key: "name", header: "Name", type: "text", value: (r) => r.name },
      {
        key: "executions",
        header: "Executions",
        type: "mono",
        value: (r) => r.runs7d.toLocaleString("en-US"),
        width: "120px",
      },
    ];

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

  /** "up" here means the average response got slower (higher ms), which is
   * bad \u2014 `trendIsGood="false"` on the kpi-card flips the color semantic. */
  protected readonly avgResponseTrend = computed(() => {
    const d = this.stats()?.avgResponseDelta ?? 0;
    return d > 0 ? "up" : d < 0 ? "down" : "flat";
  });

  protected readonly avgResponseDeltaText = computed(() => {
    const d = this.stats()?.avgResponseDelta ?? 0;
    return `${Math.abs(d)}ms`;
  });

  protected readonly errorDeltaText = computed(() => {
    const d = this.stats()?.errorRateDelta ?? 0;
    return `${Math.abs(d).toFixed(2)}%`;
  });

  protected readonly apiUsageData = computed(
    () => this.stats()?.dailyBreakdown.map((d) => d.requests) ?? []
  );

  protected readonly latencyData = computed(
    () => this.stats()?.dailyBreakdown.map((d) => d.avgLatencyMs) ?? []
  );

  protected readonly dayLabels = computed(() => {
    const breakdown = this.stats()?.dailyBreakdown ?? [];
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return breakdown.map((d) => DAYS[new Date(d.date).getUTCDay()]);
  });

  /**
   * "Actividad" row \u2014 design: Redise\u00f1o Terminal.dc.html lines 137-145
   * (timestamp + colored dot + text per activity item).
   *
   * `IDashboardActivity.type` is an untyped free string with no severity
   * mapping defined anywhere in the schema (T01 finding 5). The only
   * existing precedent for interpreting this same field \u2014 the same
   * `DashboardService.stats().recentActivity` \u2014 is
   * `RightPanelComponent.activityColor()`
   * (`src/app/layout/right-panel/right-panel.component.ts:217-228`), which
   * maps `"gateway.request"` / `"user.created"` / `"auth.failed"` to
   * accent/green/red with a neutral/purple default. This mapping reuses
   * those same known values (adapted to `ActivityTone`) instead of
   * inventing new ones; any other `type` value falls back to "neutral"
   * and is logged so an unmapped type never fails silently.
   */
  protected readonly activityEntries = computed<IActivityEntry[]>(() => {
    const activity = this.stats()?.recentActivity ?? [];
    if (activity.length === 0) {
      console.debug(
        "[DashboardComponent] recentActivity empty, activity feed will render its empty state"
      );
    }
    return activity.map((item) => ({
      time: formatDate(item.timestamp, "HH:mm", "en-US", "UTC"),
      text: item.text,
      tone: this.activityTone(item),
    }));
  });

  private activityTone(item: IDashboardActivity): ActivityTone {
    switch (item.type) {
      case "gateway.request":
        return "info";
      case "user.created":
        return "ok";
      case "auth.failed":
        return "danger";
      default:
        console.debug(
          "[DashboardComponent] unmapped recentActivity type, defaulting tone to neutral",
          { type: item.type }
        );
        return "neutral";
    }
  }

  /**
   * Row click on the "Recent workflows" table navigates to the workflow's
   * existing detail route (SPEC decision 3: deep links use existing routes
   * only — `/workflows/:id`, `app.routes.ts:307-311`).
   */
  protected onWorkflowRowClick(row: ITopWorkflowEntry): void {
    console.debug(
      "[DashboardComponent] recent-workflows row clicked, navigating",
      { workflowId: row.id }
    );
    this.router.navigate(["/workflows", row.id]).catch((error: unknown) => {
      console.error(
        "[DashboardComponent] navigation to workflow detail failed",
        { workflowId: row.id, error }
      );
    });
  }

  ngOnInit(): void {
    this.dashboard.startPolling();
    this.processes.loadTopWorkflows();
  }

  ngOnDestroy(): void {
    this.dashboard.stopPolling();
  }
}
