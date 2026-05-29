import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { GatewayAuditService } from "../../src/modules/gateway-audit/gateway-audit.service";
import { GatewayAuditMongoRepository } from "../../src/modules/gateway-audit/gateway-audit.mongo.repository";
import {
  GATEWAY_AUDIT_REPOSITORY,
} from "../../src/modules/gateway-audit/gateway-audit.repository.interface";
import { GATEWAY_AUDIT_CONSUMER } from "../../src/providers/nats.provider";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { makeMockJetStreamConsumer } from "../make-mock-consumer";
import {
  makeFakeTenantMongoConnections,
  makeMongoCollectionMock,
  makeMockDb,
} from "../make-mongo-mock";

describe("GatewayAuditService", () => {
  let service: GatewayAuditService;
  let mockTenantMgr: ReturnType<typeof makeFakeTenantMongoConnections>;

  const sampleRow = {
    _id: "r1",
    trace_id: "tr1",
    tenant_id: "t1",
    method: "GET",
    path: "/api",
    status_code: 200,
    duration_ms: 5,
    client_ip: "127.0.0.1",
    user_agent: "test",
    jwt_subject: null,
    route_type: "api",
    upstream_url: null,
    upstream_status: null,
    upstream_duration: null,
    rate_limit_applied: false,
    rate_limit_remaining: null,
    error: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  };

  beforeEach(async () => {
    const collection = makeMongoCollectionMock({
      insertMany: mock(async () => ({ insertedCount: 1 })),
      find: mock(() => ({
        sort: mock(() => ({
          skip: mock(() => ({
            limit: mock(() => ({
              toArray: mock(async () => [sampleRow]),
            })),
          })),
        })),
      })),
      findOne: mock(async () => sampleRow),
      aggregate: mock(() => ({
        toArray: mock(async () => []),
      })),
    });

    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        gateway_audit_events: collection as unknown as Record<string, unknown>,
      }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        GatewayAuditMongoRepository,
        {
          provide: GATEWAY_AUDIT_REPOSITORY,
          useExisting: GatewayAuditMongoRepository,
        },
        GatewayAuditService,
        {
          provide: GATEWAY_AUDIT_CONSUMER,
          useValue: makeMockJetStreamConsumer(),
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
      ],
    }).compile();

    service = moduleRef.get(GatewayAuditService);
  });

  it("queryEvents returns rows from tenant Mongo", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requestId).toBe("r1");
    expect(mockTenantMgr.ensureSchemaCalls.get("tenant-a")).toBe(1);
  });

  it("getEventByRequestId returns first row", async () => {
    const row = await service.getEventByRequestId("r1", "tenant-a");
    expect(row?.requestId).toBe("r1");
  });

  it("getDashboardStats aggregates KPIs, daily breakdown, and recent activity", async () => {
    const aggregateToArray = mock(async () => [
      {
        requests_today: 10,
        requests_yesterday: 8,
        error_count_today: 1,
        error_count_yesterday: 2,
        avg_response_ms: 100,
        avg_response_ms_yesterday: 90,
        p95_response_ms: 200,
        active_sessions: 3,
      },
    ]);
    const dailyToArray = mock(async () => [
      {
        day: "2026-01-01",
        requests: 4,
        avg_latency_ms: 50,
      },
    ]);
    const recentFind = mock(() => ({
      sort: mock(() => ({
        limit: mock(() => ({
          project: mock(() => ({
            toArray: mock(async () => [
              {
                method: "GET",
                path: "/api",
                status_code: 200,
                created_at: new Date("2026-01-01T00:00:00.000Z"),
              },
            ]),
          })),
        })),
      })),
    }));

    let aggregateCalls = 0;
    const collection = makeMongoCollectionMock({
      insertMany: mock(async () => ({ insertedCount: 1 })),
      find: recentFind,
      findOne: mock(async () => sampleRow),
      aggregate: mock(() => {
        aggregateCalls += 1;
        return {
          toArray:
            aggregateCalls === 1 ? aggregateToArray : dailyToArray,
        };
      }),
    });

    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        gateway_audit_events: collection as unknown as Record<string, unknown>,
      }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        GatewayAuditMongoRepository,
        {
          provide: GATEWAY_AUDIT_REPOSITORY,
          useExisting: GatewayAuditMongoRepository,
        },
        GatewayAuditService,
        {
          provide: GATEWAY_AUDIT_CONSUMER,
          useValue: makeMockJetStreamConsumer(),
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
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
