import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { AuditDashboardStats } from "@yoizen/shared";
import { DashboardProxyService } from "../../src/modules/dashboard/dashboard-proxy.service";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("DashboardProxyService", () => {
  beforeEach(() => {
    process.env.AUDIT_SERVICE_URL = "http://audit.test";
    process.env.API_GATEWAY_SELF_URL = "http://gateway.test";
  });

  it("returns cached stats when Redis hit", async () => {
    const cached = JSON.stringify({ requestsToday: 99 });
    const redis = {
      get: mock(() => Promise.resolve(cached)),
      set: mock(() => Promise.resolve("OK")),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardProxyService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    const svc = moduleRef.get(DashboardProxyService);
    const stats = await svc.getStats("tenant-a");

    expect(stats.requestsToday).toBe(99);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("aggregates audit and health when cache miss", async () => {
    const audit: AuditDashboardStats = {
      requestsToday: 10,
      requestsYesterday: 5,
      avgResponseMs: 100,
      avgResponseMsYesterday: 90,
      errorRate: 0.01,
      errorRateYesterday: 0.02,
      p95ResponseMs: 200,
      activeSessions: 3,
      dailyBreakdown: [],
      recentActivity: [],
    };

    const fetchMock = mock((url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/audit/gateway/stats")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(audit),
        });
      }
      if (u.includes("/health")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: "ok",
              nats: "ok",
              redis: "ok",
              services: { auth: { status: "ok" } },
            }),
        });
      }
      return Promise.reject(new Error(`unexpected url ${u}`));
    });
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;

    const redis = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve("OK")),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardProxyService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    const svc = moduleRef.get(DashboardProxyService);
    const stats = await svc.getStats("tenant-b");

    expect(stats.requestsToday).toBe(10);
    expect(redis.set).toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
