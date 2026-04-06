import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { vi } from "vitest";

import { DashboardComponent } from "./dashboard.component";
import { TenantService } from "../../../core/services/tenant.service";
import {
  DashboardService,
  type IDashboardStats,
} from "../../../core/services/dashboard.service";

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
  ],
  uptime: 99.9,
  p95ResponseMs: 100,
  quotaApiCalls: { used: 1, limit: 100 },
  quotaStorage: { used: 0, limit: 100 },
  quotaWebhooks: { used: 0, limit: 100 },
  recentActivity: [],
  serviceHealth: {},
};

describe("DashboardComponent", () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let startPolling: ReturnType<typeof vi.fn>;
  let stopPolling: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    startPolling = vi.fn();
    stopPolling = vi.fn();
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

  it("stops polling on destroy", () => {
    fixture.destroy();
    expect(stopPolling).toHaveBeenCalled();
  });
});
