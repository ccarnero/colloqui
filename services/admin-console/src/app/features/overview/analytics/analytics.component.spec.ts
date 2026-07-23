import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of, throwError } from "rxjs";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import type { IDashboardStats } from "../../../core/services/dashboard.service";
import { DashboardService } from "../../../core/services/dashboard.service";
import type { IWorkflowsSummary } from "../../automation/workflows/services/workflow-api.service";
import { WorkflowApiService } from "../../automation/workflows/services/workflow-api.service";
import { AnalyticsComponent } from "./analytics.component";

function buildStats(overrides: Partial<IDashboardStats> = {}): IDashboardStats {
  return {
    requestsToday: 12000,
    requestsTodayDelta: 5,
    activeSessions: 42,
    avgResponseMs: 120,
    avgResponseDelta: -3,
    errorRate: 0.5,
    errorRateDelta: -0.1,
    dailyBreakdown: [
      { date: "2026-07-01", requests: 1000, avgLatencyMs: 100 },
      { date: "2026-07-02", requests: 1500, avgLatencyMs: 110 },
    ],
    uptime: 99.9,
    p95ResponseMs: 300,
    quotaApiCalls: { used: 1, limit: 10 },
    quotaStorage: { used: 1, limit: 10 },
    quotaWebhooks: { used: 1, limit: 10 },
    recentActivity: [],
    serviceHealth: {},
    ...overrides,
  };
}

function buildWorkflowSummary(
  overrides: Partial<IWorkflowsSummary> = {}
): IWorkflowsSummary {
  return {
    activeDefinitions: 3,
    definitionsFailingNow: 0,
    definitionsWithFailuresLast7d: 1,
    executionsCompletedLast7d: 20,
    executionsFailedLast7d: 2,
    executionsRunningLast7d: 1,
    executionsCompletedLast24h: 5,
    topByExecutionCountLast7d: [
      {
        definition_id: "wf-1",
        name: "Lead qualification",
        application: "sales",
        count: 12,
      },
      {
        definition_id: "wf-2",
        name: "Ticket triage",
        application: "support",
        count: 8,
      },
    ],
    ...overrides,
  };
}

async function renderAnalyticsComponent(options: {
  stats?: IDashboardStats | null;
  dashboardLoading?: boolean;
  usageTotals?: { items: unknown[] };
  usageTotalsError?: boolean;
  summary?: IWorkflowsSummary;
  summaryError?: boolean;
}): Promise<{
  fixture: ComponentFixture<AnalyticsComponent>;
}> {
  const statsSignal = signal<IDashboardStats | null>(options.stats ?? null);
  const loadingSignal = signal(options.dashboardLoading ?? false);

  await TestBed.configureTestingModule({
    imports: [AnalyticsComponent],
    providers: [
      {
        provide: DashboardService,
        useValue: {
          stats: statsSignal,
          loading: loadingSignal,
          error: signal(null),
          startPolling: vi.fn(),
          stopPolling: vi.fn(),
        },
      },
      {
        provide: ChannelAdminService,
        useValue: {
          getUsageTotals: vi.fn().mockReturnValue(
            options.usageTotalsError
              ? throwError(() => new Error("usage totals failed"))
              : of(
                  options.usageTotals ?? {
                    items: [
                      {
                        direction: "ingress",
                        events: 8000,
                        firstTs: null,
                        lastTs: null,
                      },
                      {
                        direction: "egress",
                        events: 4200,
                        firstTs: null,
                        lastTs: null,
                      },
                    ],
                  }
                )
          ),
        },
      },
      {
        provide: WorkflowApiService,
        useValue: {
          getSummary: vi
            .fn()
            .mockReturnValue(
              options.summaryError
                ? throwError(() => new Error("summary failed"))
                : of(options.summary ?? buildWorkflowSummary())
            ),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AnalyticsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture };
}

describe("AnalyticsComponent", () => {
  it("renders Analytics title", async () => {
    const { fixture } = await renderAnalyticsComponent({ stats: buildStats() });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Analytics");
  });

  it("does not render any of the removed mock metrics", async () => {
    const { fixture } = await renderAnalyticsComponent({ stats: buildStats() });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain("Page Views");
    expect(el.textContent).not.toContain("Unique Sessions");
    expect(el.textContent).not.toContain("Bounce Rate");
    expect(el.textContent).not.toContain("Top Endpoints");
    expect(el.textContent).not.toContain("Error Breakdown");
  });

  it("renders real dashboard KPI values from DashboardService.stats", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats({
        activeSessions: 77,
        avgResponseMs: 150,
        errorRate: 1.2,
      }),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Requests today");
    expect(el.textContent).toContain("77");
    expect(el.textContent).toContain("150ms");
    expect(el.textContent).toContain("1.2%");
  });

  it("renders channel ingress/egress totals from ChannelAdminService.getUsageTotals", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats(),
      usageTotals: {
        items: [
          { direction: "ingress", events: 8000, firstTs: null, lastTs: null },
          { direction: "egress", events: 4200, firstTs: null, lastTs: null },
        ],
      },
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Channel ingress");
    expect(el.textContent).toContain("8.0K");
    expect(el.textContent).toContain("Channel egress");
    expect(el.textContent).toContain("4.2K");
  });

  it("renders workflow execution counts from WorkflowApiService.getSummary", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats(),
      summary: buildWorkflowSummary({
        executionsCompletedLast7d: 33,
        executionsFailedLast7d: 4,
      }),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Workflow runs completed");
    expect(el.textContent).toContain("33");
    expect(el.textContent).toContain("Workflow runs failed");
    expect(el.textContent).toContain("4");
  });

  it("renders the top-workflows table with real rows from the summary", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats(),
      summary: buildWorkflowSummary(),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Lead qualification");
    expect(el.textContent).toContain("Ticket triage");
    expect(el.textContent).toContain("sales");
    expect(el.textContent).toContain("12");
  });

  it("renders the workflow table's empty state when there are no top workflows", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats(),
      summary: buildWorkflowSummary({ topByExecutionCountLast7d: [] }),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(
      "No workflow executions in the last 7 days"
    );
  });

  it("shows a loading state before dashboard stats have loaded", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: null,
      dashboardLoading: true,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll(".skeleton-card").length).toBeGreaterThan(0);
    expect(el.textContent).not.toContain("Requests today");
  });

  it("surfaces the workflow-summary error state without breaking the rest of the page", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats(),
      summaryError: true,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("summary failed");
    // Dashboard KPIs still render even though the workflow summary failed.
    expect(el.textContent).toContain("Requests today");
  });

  it("surfaces the channel-usage error state without breaking the rest of the page", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats(),
      usageTotalsError: true,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("usage totals failed");
    // Dashboard KPIs still render even though the channel usage totals failed.
    expect(el.textContent).toContain("Requests today");
  });

  it("passes the dailyBreakdown-derived rows into the usage chart component", async () => {
    const { fixture } = await renderAnalyticsComponent({
      stats: buildStats({
        dailyBreakdown: [
          { date: "2026-07-05", requests: 999, avgLatencyMs: 20 },
        ],
      }),
    });
    const chartEl = (fixture.nativeElement as HTMLElement).querySelector(
      "app-usage-chart"
    );
    expect(chartEl).not.toBeNull();
  });
});
