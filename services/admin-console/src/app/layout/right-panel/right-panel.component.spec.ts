import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";

import { RightPanelComponent } from "./right-panel.component";
import {
  DashboardService,
  type IDashboardStats,
} from "../../core/services/dashboard.service";

const mockStats: IDashboardStats = {
  requestsToday: 0,
  requestsTodayDelta: 0,
  activeSessions: 0,
  avgResponseMs: 50,
  avgResponseDelta: 0,
  errorRate: 0.5,
  errorRateDelta: -0.1,
  dailyBreakdown: [],
  uptime: 99,
  p95ResponseMs: 100,
  quotaApiCalls: { used: 100, limit: 1000 },
  quotaStorage: { used: 1, limit: 10 },
  quotaWebhooks: { used: 0, limit: 10 },
  recentActivity: [],
  serviceHealth: {},
};

describe("RightPanelComponent", () => {
  let fixture: ComponentFixture<RightPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RightPanelComponent],
      providers: [
        {
          provide: DashboardService,
          useValue: {
            stats: signal<IDashboardStats | null>(mockStats),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RightPanelComponent);
    fixture.detectChanges();
  });

  it("renders tenant health section", () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain("Tenant Health");
    expect(el.textContent).toContain("Quota Usage");
  });
});
