import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { vi } from "vitest";
import {
  DashboardService,
  type IDashboardStats,
} from "../../../core/services/dashboard.service";
import {
  type ITopWorkflowEntry,
  ProcessesMetricsService,
} from "../../../core/services/metrics/processes-metrics.service";
import { TenantService } from "../../../core/services/tenant.service";
import { DashboardComponent } from "./dashboard.component";

const mockTopWorkflows: ITopWorkflowEntry[] = [
  { id: "wf-1", name: "lead-qualification", runs7d: 1842, successRate: 1 },
  { id: "wf-2", name: "order-status-lookup", runs7d: 923, successRate: 1 },
];

const mockStats: IDashboardStats = {
  requestsToday: 100,
  requestsTodayDelta: 5,
  activeSessions: 10,
  avgResponseMs: 50,
  avgResponseDelta: -10,
  errorRate: 0.1,
  errorRateDelta: -0.01,
  dailyBreakdown: [
    { date: "2024-06-01T00:00:00.000Z", requests: 10, avgLatencyMs: 50 },
    { date: "2024-06-02T00:00:00.000Z", requests: 20, avgLatencyMs: 60 },
  ],
  uptime: 99.9,
  p95ResponseMs: 100,
  quotaApiCalls: { used: 1, limit: 100 },
  quotaStorage: { used: 0, limit: 100 },
  quotaWebhooks: { used: 0, limit: 100 },
  recentActivity: [
    {
      type: "user.created",
      text: "workflow lead-qualification executed",
      timestamp: "2024-06-02T14:22:00.000Z",
    },
    {
      type: "auth.failed",
      text: "delivery failed · WhatsApp 131047",
      timestamp: "2024-06-02T14:07:00.000Z",
    },
    {
      type: "some.unmapped.type",
      text: "webhook acme-crm degraded",
      timestamp: "2024-06-02T13:12:00.000Z",
    },
  ],
  serviceHealth: {},
};

describe("DashboardComponent", () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let startPolling: ReturnType<typeof vi.fn>;
  let stopPolling: ReturnType<typeof vi.fn>;
  let loadTopWorkflows: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    startPolling = vi.fn();
    stopPolling = vi.fn();
    loadTopWorkflows = vi.fn();
    navigate = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test Tenant",
              configuration: {},
            }),
          },
        },
        {
          provide: DashboardService,
          useValue: {
            stats: signal(mockStats),
            loading: signal(false),
            startPolling,
            stopPolling,
          },
        },
        {
          provide: ProcessesMetricsService,
          useValue: {
            topWorkflows: signal(mockTopWorkflows),
            loadTopWorkflows,
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
  });

  it("renders Dashboard title and tenant name", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Dashboard");
    expect(el.textContent).toContain("Test Tenant");
  });

  it("starts polling on init", () => {
    expect(startPolling).toHaveBeenCalled();
  });

  it("loads top workflows on init", () => {
    expect(loadTopWorkflows).toHaveBeenCalled();
  });

  it("stops polling on destroy", () => {
    fixture.destroy();
    expect(stopPolling).toHaveBeenCalled();
  });

  it("renders the 4 metric cards mapped from IDashboardStats with their deltas", () => {
    const el = fixture.nativeElement as HTMLElement;
    const labels = Array.from(el.querySelectorAll(".kpi-label")).map(
      (n) => n.textContent
    );
    expect(labels).toEqual([
      "API calls today",
      "Active sessions",
      "Avg response",
      "Error rate",
    ]);

    const values = Array.from(el.querySelectorAll(".kpi-value")).map(
      (n) => n.textContent
    );
    expect(values).toEqual(["100", "10", "50ms", "0.1%"]);

    expect(el.textContent).toContain("last 15 min");
    expect(el.textContent).toContain("p50 · 7 days");
  });

  it("attaches sparklines only to metrics with a real daily series (API calls today, Avg response)", () => {
    const el = fixture.nativeElement as HTMLElement;
    const sparks = el.querySelectorAll(".kpi-spark");
    // Active sessions and Error rate have no dailyBreakdown-derived series.
    expect(sparks.length).toBe(2);
  });

  it("renders the API-usage panel with the Normal badge from dailyBreakdown", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("API usage · 7 days");
    expect(el.textContent).toContain("Normal");
  });

  it("renders Actividad rows from recentActivity with mapped tones", () => {
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll(".feed-row");
    expect(rows.length).toBe(3);
    expect(el.textContent).toContain("workflow lead-qualification executed");
    expect(el.textContent).toContain("delivery failed · WhatsApp 131047");

    const dots = el.querySelectorAll(".feed-dot");
    expect(dots[0].className).toContain("tone-ok"); // "user.created"
    expect(dots[1].className).toContain("tone-danger"); // "auth.failed"
    expect(dots[2].className).toContain("tone-neutral"); // unmapped type falls back to neutral
  });

  it("renders the Recent workflows table with only Name and Executions columns from ProcessesMetricsService.topWorkflows", () => {
    const el = fixture.nativeElement as HTMLElement;
    const headers = Array.from(el.querySelectorAll(".table-header-cell")).map(
      (n) => n.textContent
    );
    expect(headers).toEqual(["Name", "Executions"]);
    // Trigger/p95/Estado are dropped (amended decision 4, no data source).
    expect(el.textContent).not.toContain("Trigger");
    expect(el.textContent).not.toContain("p95");
    expect(el.textContent).not.toContain("Estado");

    const rows = el.querySelectorAll(".table-row");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("lead-qualification");
    expect(rows[0].textContent).toContain("1,842");
    expect(rows[1].textContent).toContain("order-status-lookup");
    expect(rows[1].textContent).toContain("923");
  });

  it("navigates to the workflow detail route on row click", () => {
    const el = fixture.nativeElement as HTMLElement;
    const firstRow = el.querySelector(".table-row") as HTMLElement;
    firstRow.click();
    expect(navigate).toHaveBeenCalledWith(["/workflows", "wf-1"]);
  });
});

describe("DashboardComponent — Avg response trend (regression: bug fix `d <= 80` -> `d <= 0`)", () => {
  // Regression tests for the dead-computed bug fixed alongside `avgResponseTrend` /
  // `avgResponseDeltaText`: the old (unused) computeds compared `d <= 80` instead of
  // `d <= 0`. These assert the real kpi-card DOM/classes produced with
  // `[trendIsGood]="false"` on the "Avg response" card, per KpiCardComponent.trendClass().

  function statsWithAvgResponseDelta(delta: number): IDashboardStats {
    return { ...mockStats, avgResponseDelta: delta };
  }

  async function renderWithAvgResponseDelta(
    delta: number
  ): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test Tenant",
              configuration: {},
            }),
          },
        },
        {
          provide: DashboardService,
          useValue: {
            stats: signal(statsWithAvgResponseDelta(delta)),
            loading: signal(false),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
        {
          provide: ProcessesMetricsService,
          useValue: {
            topWorkflows: signal(mockTopWorkflows),
            loadTopWorkflows: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn().mockResolvedValue(true) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function findAvgResponseTrendEl(el: HTMLElement): HTMLElement {
    const cards = Array.from(el.querySelectorAll(".kpi"));
    const card = cards.find(
      (c) => c.querySelector(".kpi-label")?.textContent === "Avg response"
    );
    expect(card).toBeTruthy();
    const trendEl = card!.querySelector(".kpi-sub > span:first-child");
    expect(trendEl).toBeTruthy();
    return trendEl as HTMLElement;
  }

  it("renders a POSITIVE delta (slower response) as an 'up' trend colored BAD (trend-up-bad)", async () => {
    const el = await renderWithAvgResponseDelta(15);
    const trendEl = findAvgResponseTrendEl(el);
    expect(trendEl.className).toContain("trend-up-bad");
    expect(trendEl.className).not.toContain("trend-down-good");
    expect(trendEl.textContent).toContain("↑");
    expect(trendEl.textContent).toContain("15ms");
  });

  it("renders a NEGATIVE delta (faster response) as a 'down' trend colored GOOD (trend-down-good)", async () => {
    const el = await renderWithAvgResponseDelta(-10);
    const trendEl = findAvgResponseTrendEl(el);
    expect(trendEl.className).toContain("trend-down-good");
    expect(trendEl.className).not.toContain("trend-up-bad");
    expect(trendEl.textContent).toContain("↓");
    expect(trendEl.textContent).toContain("10ms");
  });

  it("renders a ZERO delta as the flat/neutral trend (trend-flat)", async () => {
    const el = await renderWithAvgResponseDelta(0);
    const trendEl = findAvgResponseTrendEl(el);
    expect(trendEl.className).toContain("trend-flat");
    expect(trendEl.className).not.toContain("trend-up-bad");
    expect(trendEl.className).not.toContain("trend-down-good");
    expect(trendEl.textContent).toContain("→");
    expect(trendEl.textContent).toContain("0ms");
  });
});

describe("DashboardComponent — loading and empty states", () => {
  let fixture: ComponentFixture<DashboardComponent>;

  it("renders skeleton placeholders when loading and stats are not yet available", async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test Tenant",
              configuration: {},
            }),
          },
        },
        {
          provide: DashboardService,
          useValue: {
            stats: signal(null),
            loading: signal(true),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
        {
          provide: ProcessesMetricsService,
          useValue: {
            topWorkflows: signal(mockTopWorkflows),
            loadTopWorkflows: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn().mockResolvedValue(true) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll(".skeleton-card").length).toBe(4);
    expect(el.querySelector(".kpi-label")).toBeNull();
  });

  it("renders the empty state in the activity feed when recentActivity is empty", async () => {
    const emptyStats: IDashboardStats = {
      requestsToday: 0,
      requestsTodayDelta: 0,
      activeSessions: 0,
      avgResponseMs: 0,
      avgResponseDelta: 0,
      errorRate: 0,
      errorRateDelta: 0,
      dailyBreakdown: [],
      uptime: 100,
      p95ResponseMs: 0,
      quotaApiCalls: { used: 0, limit: 100 },
      quotaStorage: { used: 0, limit: 100 },
      quotaWebhooks: { used: 0, limit: 100 },
      recentActivity: [],
      serviceHealth: {},
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test Tenant",
              configuration: {},
            }),
          },
        },
        {
          provide: DashboardService,
          useValue: {
            stats: signal(emptyStats),
            loading: signal(false),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
        {
          provide: ProcessesMetricsService,
          useValue: {
            topWorkflows: signal(mockTopWorkflows),
            loadTopWorkflows: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn().mockResolvedValue(true) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll(".feed-row").length).toBe(0);
    expect(el.textContent).toContain("No recent activity");
    // No sparklines rendered when dailyBreakdown is empty.
    expect(el.querySelectorAll(".kpi-spark").length).toBe(0);
  });

  it("renders the empty state in the recent-workflows table when topWorkflows is empty", async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenant: signal({
              id: "t1",
              name: "Test Tenant",
              configuration: {},
            }),
          },
        },
        {
          provide: DashboardService,
          useValue: {
            stats: signal(mockStats),
            loading: signal(false),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
        {
          provide: ProcessesMetricsService,
          useValue: {
            topWorkflows: signal([]),
            loadTopWorkflows: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn().mockResolvedValue(true) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll(".table-row").length).toBe(0);
    expect(el.textContent).toContain("No recent workflows");
  });
});
