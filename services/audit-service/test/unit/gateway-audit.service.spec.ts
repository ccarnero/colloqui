import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { GatewayAuditService } from "../../src/modules/gateway-audit/gateway-audit.service";
import { GATEWAY_AUDIT_CONSUMER } from "../../src/providers/nats.provider";
import { TenantConnectionManager, type Sql } from "@yoizen/database";
import { makeMockJetStreamConsumer } from "../make-mock-consumer";

describe("GatewayAuditService", () => {
  let service: GatewayAuditService;
  let mockTenantMgr: {
    ensureSchema: ReturnType<typeof mock>;
    getConnection: ReturnType<typeof mock>;
    isNamespaceInitialized: ReturnType<typeof mock>;
    markNamespaceInitialized: ReturnType<typeof mock>;
  };

  const sampleRow = {
    requestId: "r1",
    traceId: "tr1",
    tenantId: "t1",
    method: "GET",
    path: "/api",
    statusCode: 200,
    durationMs: 5,
    clientIp: "127.0.0.1",
    userAgent: "test",
    jwtSubject: null,
    routeType: "api",
    upstreamUrl: null,
    upstreamStatus: null,
    upstreamDuration: null,
    rateLimitApplied: false,
    rateLimitRemaining: null,
    error: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(async () => {
    const mockSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve([sampleRow]),
      { unsafe: (s: string) => s },
    ) as Sql;

    // ensureTenantNamespaceOnce now resolves the tenant tier asynchronously
    // through ensureSchema BEFORE running DDL — mirror that contract here.
    mockTenantMgr = {
      ensureSchema: mock(async () => mockSql),
      getConnection: mock(() => mockSql),
      isNamespaceInitialized: mock(() => false),
      markNamespaceInitialized: mock(() => {}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GatewayAuditService,
        { provide: GATEWAY_AUDIT_CONSUMER, useValue: makeMockJetStreamConsumer() },
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    service = moduleRef.get(GatewayAuditService);
  });

  it("queryEvents returns rows from tenant SQL", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requestId).toBe("r1");
    expect(mockTenantMgr.getConnection).toHaveBeenCalledWith("tenant-a");
  });

  it("getEventByRequestId returns first row", async () => {
    const row = await service.getEventByRequestId("r1", "tenant-a");
    expect(row?.requestId).toBe("r1");
  });

  it("getDashboardStats aggregates KPIs, daily breakdown, and recent activity", async () => {
    const makeSql = (): Sql =>
      Object.assign(
        (strings: TemplateStringsArray) => {
          const h = strings[0] ?? "";
          if (h.includes("CREATE TABLE") || h.includes("CREATE INDEX")) {
            return Promise.resolve([]);
          }
          if (h.includes("AS requests_today")) {
            return Promise.resolve([
              {
                requests_today: "10",
                requests_yesterday: "8",
                error_count_today: "1",
                error_count_yesterday: "2",
                avg_response_ms: "100",
                avg_response_ms_yesterday: "90",
                p95_response_ms: "200",
                active_sessions: "3",
              },
            ]);
          }
          if (h.includes("AS day") && h.includes("GROUP BY")) {
            return Promise.resolve([
              {
                day: "2026-01-01",
                requests: "4",
                avg_latency_ms: "50",
              },
            ]);
          }
          if (h.includes("LIMIT 20")) {
            return Promise.resolve([
              {
                method: "GET",
                path: "/api",
                status_code: 200,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ]);
          }
          return Promise.resolve([]);
        },
        { unsafe: (s: string) => s },
      ) as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        GatewayAuditService,
        { provide: GATEWAY_AUDIT_CONSUMER, useValue: makeMockJetStreamConsumer() },
        {
          provide: TenantConnectionManager,
          useValue: {
            ensureSchema: mock(async () => makeSql()),
            getConnection: mock(() => makeSql()),
            isInitialized: mock(() => false),
            markInitialized: mock(() => {}),
            isNamespaceInitialized: mock(() => false),
            markNamespaceInitialized: mock(() => {}),
          },
        },
      ],
    }).compile();

    const dashService = moduleRef.get(GatewayAuditService);
    const stats = await dashService.getDashboardStats("tenant-dash");

    expect(stats.requestsToday).toBe(10);
    expect(stats.requestsYesterday).toBe(8);
    expect(stats.avgResponseMs).toBe(100);
    expect(stats.p95ResponseMs).toBe(200);
    expect(stats.activeSessions).toBe(3);
    expect(stats.dailyBreakdown).toHaveLength(1);
    expect(stats.dailyBreakdown[0]?.date).toBe("2026-01-01");
    expect(stats.recentActivity).toHaveLength(1);
    expect(stats.recentActivity[0]?.text).toContain("GET /api");
  });
});
