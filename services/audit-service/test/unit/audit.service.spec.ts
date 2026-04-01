import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Consumer } from "nats";
import { AuditService, type IAuditEvent } from "../../src/modules/audit/audit.service";
import { JETSTREAM_CLIENT } from "../../src/providers/nats.provider";
import { TenantConnectionManager, type Sql } from "../../src/providers/tenant-connection-manager";

function makeMockConsumer(): Consumer {
  return {
    consume: mock(() =>
      Promise.resolve({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }),
        stop: mock(),
      }),
    ),
  } as unknown as Consumer;
}

describe("AuditService", () => {
  let service: AuditService;
  let mockSql: Sql;
  let mockTenantMgr: {
    getConnection: ReturnType<typeof mock>;
    isInitialized: ReturnType<typeof mock>;
    markInitialized: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const sample: IAuditEvent = {
      id: "evt-1",
      type: "user.created",
      payload: { a: 1 },
      metadata: { tenant: "t1" },
      subject: "events.user",
      created_at: new Date().toISOString(),
    };

    mockSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        return Promise.resolve([sample]);
      },
      {},
    ) as Sql;

    mockTenantMgr = {
      getConnection: mock(() => mockSql),
      isInitialized: mock(() => true),
      markInitialized: mock(() => {}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: JETSTREAM_CLIENT, useValue: makeMockConsumer() },
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
  });

  it("queryEvents returns rows from SQL", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("evt-1");
    expect(mockTenantMgr.getConnection).toHaveBeenCalledWith("tenant-a");
  });

  it("getEventById returns a row when present", async () => {
    const row = await service.getEventById("evt-1", "tenant-a");
    expect(row).not.toBeNull();
    expect(row?.type).toBe("user.created");
  });

  it("getEventById returns null when no row", async () => {
    const emptySql = Object.assign(
      () => Promise.resolve([]),
      {},
    ) as Sql;
    mockTenantMgr.getConnection.mockReturnValue(emptySql);

    const row = await service.getEventById("missing", "tenant-a");
    expect(row).toBeNull();
  });
});
