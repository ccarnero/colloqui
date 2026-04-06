import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";

import { DashboardService } from "./dashboard.service";
import { environment } from "../../../environments/environment";

const minimalStats = {
  requestsToday: 0,
  requestsTodayDelta: 0,
  activeSessions: 0,
  avgResponseMs: 0,
  avgResponseDelta: 0,
  errorRate: 0,
  errorRateDelta: 0,
  dailyBreakdown: [],
  uptime: 1,
  p95ResponseMs: 0,
  quotaApiCalls: { used: 0, limit: 1 },
  quotaStorage: { used: 0, limit: 1 },
  quotaWebhooks: { used: 0, limit: 1 },
  recentActivity: [],
  serviceHealth: {},
};

describe("DashboardService", () => {
  let service: DashboardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DashboardService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(DashboardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("startPolling fetches stats from dashboard endpoint", () => {
    service.startPolling();
    const req = httpMock.expectOne(`${environment.apiUrl}/dashboard/stats`);
    expect(req.request.method).toBe("GET");
    req.flush(minimalStats);
    expect(service.stats()).toEqual(minimalStats);
    expect(service.loading()).toBe(false);
    service.stopPolling();
    httpMock.verify();
  });

  it("stopPolling clears interval without further requests", () => {
    service.startPolling();
    const req = httpMock.expectOne(`${environment.apiUrl}/dashboard/stats`);
    req.flush(minimalStats);
    service.stopPolling();
    httpMock.verify();
  });

  it("ngOnDestroy stops polling", () => {
    service.startPolling();
    const req = httpMock.expectOne(`${environment.apiUrl}/dashboard/stats`);
    req.flush(minimalStats);
    service.ngOnDestroy();
    httpMock.verify();
  });
});
