import { NotFoundException } from "@nestjs/common";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import type { AuditDashboardStats } from "@yoizen/shared";
import { GatewayAuditController } from "../../src/modules/gateway-audit/gateway-audit.controller";
import { GatewayAuditService } from "../../src/modules/gateway-audit/gateway-audit.service";

const emptyDashboardStats = (): AuditDashboardStats => ({
  requestsToday: 0,
  requestsYesterday: 0,
  avgResponseMs: 0,
  avgResponseMsYesterday: 0,
  errorRate: 0,
  errorRateYesterday: 0,
  p95ResponseMs: 0,
  activeSessions: 0,
  dailyBreakdown: [],
  recentActivity: [],
});

describe("GatewayAuditController", () => {
  let controller: GatewayAuditController;
  let getEventByRequestId: ReturnType<typeof mock>;

  beforeEach(async () => {
    getEventByRequestId = mock(() => Promise.resolve(null));
    const mockSvc = {
      queryEvents: mock(() => Promise.resolve([])),
      getEventByRequestId,
      getDashboardStats: mock(() => Promise.resolve(emptyDashboardStats())),
    };
    const module = await Test.createTestingModule({
      controllers: [GatewayAuditController],
      providers: [{ provide: GatewayAuditService, useValue: mockSvc }],
    }).compile();

    controller = module.get(GatewayAuditController);
  });

  it("queryEvents returns list envelope", async () => {
    const r = await controller.queryEvents("t1", {
      limit: 10,
      offset: 0,
    } as never);
    expect(r.events).toEqual([]);
    expect(r.limit).toBe(10);
    expect(r.offset).toBe(0);
  });

  it("getDashboardStats delegates to service", async () => {
    const r = await controller.getDashboardStats("t1");
    expect(r.requestsToday).toBe(0);
    expect(Array.isArray(r.dailyBreakdown)).toBe(true);
  });

  it("getEvent returns row when found", async () => {
    getEventByRequestId.mockImplementation(() =>
      Promise.resolve({ requestId: "req-1" } as never),
    );
    const ev = await controller.getEvent("t1", "req-1");
    expect((ev as { requestId: string }).requestId).toBe("req-1");
  });

  it("getEvent throws when missing", async () => {
    await expect(controller.getEvent("t1", "nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
