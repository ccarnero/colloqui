import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import type { IUsageTotalsRow } from "../../../core/models/channel-streams.model";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import { DashboardService } from "../../../core/services/dashboard.service";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../../shared/components/inventory-table/inventory-table.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { formatCompact } from "../../../shared/utils/format-compact";
import {
  type ITopDefinitionRow,
  type IWorkflowsSummary,
  WorkflowApiService,
} from "../../automation/workflows/services/workflow-api.service";
import { UsageChartComponent } from "../../channels/detail/usage-chart.component";
import { mapDailyBreakdownToUsageRows } from "./analytics-daily-breakdown-to-usage-rows";

const CHANNEL_USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Analytics screen, rebuilt from REAL data sources per SPEC
 * `console-redesign-users-analytics-settings.md` decision 2 amendment (a),
 * AMENDED 2026-07-23 (human sign-off, post-T01 findings 2-3): the previous
 * screen was 100% hard-coded mock data (Page Views / Unique Sessions / Avg
 * Session / Bounce Rate KPIs, Top Endpoints / Error Breakdown tables) with
 * no backing service call — those mocks are REMOVED, not restyled.
 *
 * Composed from three existing, already-wired sources — no new endpoints
 * (decision 4):
 *  - `DashboardService.stats()` — requestsToday / activeSessions /
 *    avgResponseMs / errorRate + `dailyBreakdown` (same source L1
 *    Dashboard uses, T01 finding 2).
 *  - `ChannelAdminService.getUsageTotals` — fleet-wide ingress/egress
 *    totals over the last 30 days (same endpoint the Channels fleet strip
 *    uses, T01 finding 11).
 *  - `WorkflowApiService.getSummary` — 7d executions completed/failed +
 *    top-5 workflows by execution count (same endpoint L5 Workflows wires,
 *    T01 finding 1).
 *
 * The design's Analytics metric set ("Conversaciones", "Resueltas sin
 * humano %", "1ª respuesta p50/p95", "Tokens LLM · 30d", per-agent table)
 * has NO backing data source anywhere in the app (T01 finding 2) — per the
 * amendment those are a backend follow-up and are NOT rendered here.
 */
@Component({
  selector: "app-analytics",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    KpiCardComponent,
    InventoryTableComponent,
    UsageChartComponent,
  ],
  template: `
    <app-page-header
      title="Analytics"
      subtitle="Real usage and performance metrics"
    />

    <!-- KPI row: dashboard stats (requests/sessions/latency/errors),
         channel fleet usage totals (ingress/egress, 30d), and workflow
         execution summary (7d) — decision 2 amendment (a). -->
    <div class="cards-grid">
      @if (dashboardLoading() && !dashboardStats()) {
        @for (_ of skeletonCards; track $index) {
          <div class="card skeleton-card">
            <div class="skeleton-line short"></div>
            <div class="skeleton-line wide"></div>
          </div>
        }
      } @else {
        <app-kpi-card
          label="Requests today"
          [value]="formattedRequestsToday()"
          sub="vs yesterday"
          [trend]="requestsTrend()"
          [trendLabel]="formattedRequestsDelta()"
        />
        <app-kpi-card
          label="Active sessions"
          [value]="dashboardStats()?.activeSessions ?? 0"
          sub="last 15 min"
        />
        <app-kpi-card
          label="Avg response"
          [value]="(dashboardStats()?.avgResponseMs ?? 0) + 'ms'"
          sub="p50 · 7 days"
          [trendIsGood]="false"
        />
        <app-kpi-card
          label="Error rate"
          [value]="(dashboardStats()?.errorRate ?? 0) + '%'"
          sub="vs yesterday"
          [trendIsGood]="false"
        />
      }

      @if (channelUsageLoading()) {
        <div class="card skeleton-card">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line wide"></div>
        </div>
        <div class="card skeleton-card">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line wide"></div>
        </div>
      } @else if (channelUsageError()) {
        <div class="alert alert-error">{{ channelUsageError() }}</div>
      } @else {
        <app-kpi-card
          label="Channel ingress · 30d"
          [value]="formattedChannelIngress()"
          sub="all channels"
        />
        <app-kpi-card
          label="Channel egress · 30d"
          [value]="formattedChannelEgress()"
          sub="all channels"
        />
      }

      @if (workflowLoading()) {
        <div class="card skeleton-card">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line wide"></div>
        </div>
        <div class="card skeleton-card">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line wide"></div>
        </div>
      } @else {
        <app-kpi-card
          label="Workflow runs completed · 7d"
          [value]="workflowSummary()?.executionsCompletedLast7d ?? 0"
        />
        <app-kpi-card
          label="Workflow runs failed · 7d"
          [value]="workflowSummary()?.executionsFailedLast7d ?? 0"
          [trendIsGood]="false"
        />
      }
    </div>

    <!-- Chart: reuses UsageChartComponent's multi-series SVG area+line
         pattern (SPEC decision 3, RESOLVED 2026-07-23) fed by the
         dailyBreakdown -> IUsageBucketRow adapter. -->
    <div class="section-card" style="margin-bottom: 16px">
      <div class="section-card-header">
        <div class="section-card-title">Requests · daily</div>
      </div>
      <div class="section-card-body">
        <app-usage-chart [data]="chartRows()" />
      </div>
    </div>

    <!-- Top workflows by execution count (7d) — real data from
         WorkflowApiService.getSummary().topByExecutionCountLast7d. -->
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">Top workflows · 7d executions</div>
      </div>
      @if (workflowLoading()) {
        <div class="table-wrap" style="padding: 24px; text-align: center; color: var(--rd-text-3)">
          Loading workflow summary...
        </div>
      } @else if (workflowError()) {
        <div class="alert alert-error">{{ workflowError() }}</div>
      } @else {
        <app-inventory-table
          [columns]="workflowColumns"
          [rows]="topWorkflows()"
          ariaLabel="Top workflows by execution count"
          emptyMessage="No workflow executions in the last 7 days"
        />
      }
    </div>
  `,
  styles: `
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
    .skeleton-line.short {
      width: 60%;
    }
    .skeleton-line.wide {
      width: 40%;
      height: 22px;
    }
    @keyframes pulse {
      0%,
      100% {
        opacity: 0.4;
      }
      50% {
        opacity: 1;
      }
    }
  `,
})
export class AnalyticsComponent implements OnInit, OnDestroy {
  private readonly dashboard = inject(DashboardService);
  private readonly channels = inject(ChannelAdminService);
  private readonly workflows = inject(WorkflowApiService);

  protected readonly skeletonCards = Array.from({ length: 4 });

  protected readonly dashboardStats = this.dashboard.stats;
  protected readonly dashboardLoading = this.dashboard.loading;

  protected readonly channelUsageLoading = signal(true);
  protected readonly channelUsageError = signal<string | null>(null);
  protected readonly channelUsageTotals = signal<IUsageTotalsRow[]>([]);

  protected readonly workflowLoading = signal(true);
  protected readonly workflowError = signal<string | null>(null);
  protected readonly workflowSummary = signal<IWorkflowsSummary | null>(null);

  protected readonly workflowColumns: InventoryTableColumn<ITopDefinitionRow>[] =
    [
      {
        key: "name",
        header: "Workflow",
        type: "text",
        value: (w) => w.name,
        width: "2fr",
      },
      {
        key: "application",
        header: "Application",
        type: "text",
        value: (w) => w.application,
        width: "1.4fr",
      },
      {
        key: "count",
        header: "Executions · 7d",
        type: "mono",
        value: (w) => String(w.count),
        width: "1fr",
      },
    ];

  protected readonly formattedRequestsToday = computed(() =>
    formatCompact(this.dashboardStats()?.requestsToday ?? 0)
  );

  protected readonly formattedRequestsDelta = computed(() => {
    const delta = this.dashboardStats()?.requestsTodayDelta ?? 0;
    return `${delta >= 0 ? "+" : ""}${delta}%`;
  });

  protected readonly requestsTrend = computed(() => {
    const delta = this.dashboardStats()?.requestsTodayDelta ?? 0;
    if (delta > 0) {
      return "up" as const;
    }
    if (delta < 0) {
      return "down" as const;
    }
    return "flat" as const;
  });

  protected readonly formattedChannelIngress = computed(() =>
    formatCompact(this.sumUsageDirection(this.channelUsageTotals(), "ingress"))
  );

  protected readonly formattedChannelEgress = computed(() =>
    formatCompact(this.sumUsageDirection(this.channelUsageTotals(), "egress"))
  );

  protected readonly topWorkflows = computed(() => {
    const rows = this.workflowSummary()?.topByExecutionCountLast7d ?? [];
    if (rows.length === 0) {
      // Verbose logging: empty top-workflows table must not fail silently.
      console.debug(
        "[AnalyticsComponent] topByExecutionCountLast7d empty, table will render its empty state"
      );
    }
    return rows;
  });

  protected readonly chartRows = computed(() => {
    const breakdown = this.dashboardStats()?.dailyBreakdown ?? [];
    const rows = mapDailyBreakdownToUsageRows(breakdown);
    console.debug(
      "[AnalyticsComponent] chart rows mapped from dailyBreakdown",
      {
        breakdownDays: breakdown.length,
        rows: rows.length,
      }
    );
    return rows;
  });

  ngOnInit(): void {
    console.debug(
      "[AnalyticsComponent] initializing, starting dashboard polling"
    );
    this.dashboard.startPolling();
    this.loadChannelUsageTotals();
    this.loadWorkflowSummary();
  }

  ngOnDestroy(): void {
    console.debug(
      "[AnalyticsComponent] destroying, stopping dashboard polling"
    );
    this.dashboard.stopPolling();
  }

  private loadChannelUsageTotals(): void {
    this.channelUsageLoading.set(true);
    this.channelUsageError.set(null);
    const to = new Date();
    const from = new Date(to.getTime() - CHANNEL_USAGE_WINDOW_MS);
    console.debug("[AnalyticsComponent] loading channel usage totals", {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    this.channels
      .getUsageTotals({ from: from.toISOString(), to: to.toISOString() })
      .subscribe({
        next: (result) => {
          this.channelUsageTotals.set(result.items);
          this.channelUsageLoading.set(false);
          console.debug("[AnalyticsComponent] channel usage totals loaded", {
            rows: result.items.length,
          });
        },
        error: (err) => {
          this.channelUsageError.set(
            err?.message ?? "Failed to load channel usage totals"
          );
          this.channelUsageLoading.set(false);
          console.error(
            "[AnalyticsComponent] failed to load channel usage totals",
            { error: err }
          );
        },
      });
  }

  private loadWorkflowSummary(): void {
    this.workflowLoading.set(true);
    this.workflowError.set(null);
    console.debug("[AnalyticsComponent] loading workflow summary");
    this.workflows.getSummary().subscribe({
      next: (summary) => {
        this.workflowSummary.set(summary);
        this.workflowLoading.set(false);
        console.debug("[AnalyticsComponent] workflow summary loaded", {
          completed7d: summary.executionsCompletedLast7d,
          failed7d: summary.executionsFailedLast7d,
          topCount: summary.topByExecutionCountLast7d.length,
        });
      },
      error: (err) => {
        this.workflowError.set(
          err?.message ?? "Failed to load workflow summary"
        );
        this.workflowLoading.set(false);
        console.error("[AnalyticsComponent] failed to load workflow summary", {
          error: err,
        });
      },
    });
  }

  private sumUsageDirection(
    rows: IUsageTotalsRow[],
    direction: "ingress" | "egress"
  ): number {
    return rows
      .filter((r) => r.direction === direction)
      .reduce((sum, r) => sum + r.events, 0);
  }
}
