import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { EventEnvelope } from "@yoizen/shared";
import { AuditRepository } from "../../src/modules/audit/audit.repository";
import {
  AuditService,
  type IAuditEvent,
} from "../../src/modules/audit/audit.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  NATS_CONNECTION,
} from "../../src/providers/nats.provider";
import { TenantConnectionManager, type Sql } from "@yoizen/database";

const mockNatsConnection = {
  subscribe: mock(() => ({
    unsubscribe: mock(() => {}),
  })),
};

async function* emptyStreamList(): AsyncGenerator<never> {
  return;
}
const mockJsm = {
  streams: {
    info: mock(() => Promise.resolve({})),
    add: mock(() => Promise.resolve({})),
    list: mock(() => emptyStreamList()),
  },
  consumers: {
    info: mock(() => Promise.reject(new Error("consumer not found"))),
    add: mock(() => Promise.resolve({})),
  },
};
const mockJs = { consumers: { get: mock(() => Promise.reject(new Error("skip"))) } };

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
        AuditRepository,
        AuditService,
        { provide: NATS_CONNECTION, useValue: mockNatsConnection },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
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
    const emptySql = Object.assign(() => Promise.resolve([]), {}) as Sql;
    mockTenantMgr.getConnection.mockReturnValue(emptySql);

    const row = await service.getEventById("missing", "tenant-a");
    expect(row).toBeNull();
  });

  it("persistAuditEnvelope inserts when tenant present", async () => {
    let insertCount = 0;
    const trackingSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        const head = _strings[0] ?? "";
        if (head.includes("INSERT INTO events")) {
          insertCount += 1;
        }
        if (head.includes("CREATE TABLE")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
      {},
    ) as Sql;

    mockTenantMgr.isInitialized.mockReturnValue(false);
    mockTenantMgr.getConnection.mockReturnValue(trackingSql);

    const persist = service as unknown as {
      persistAuditEnvelope: (
        envelope: EventEnvelope,
        subject: string,
      ) => Promise<void>;
    };
    await persist.persistAuditEnvelope(
      {
        specversion: "1.0",
        id: "e1",
        source: "src",
        type: "t.test",
        resource: "r",
        time: new Date().toISOString(),
        traceid: "tr",
        causation_id: null,
        correlation_id: "co",
        tenant: "tenant-a",
        producer: "p",
        domain: "d",
        channel: "c",
        provider: "p",
        accountid: "a",
        idempotencykey: "k",
        transport: {
          method: "webhook",
          protocol: "https",
        },
        data: {
          received_at: new Date().toISOString(),
          payload_inline: true,
          payload_ref: null,
          payload_bytes: 0,
          payload_checksum: "x",
          payload: { x: 1 },
        },
      },
      "events.test.subject",
    );

    expect(insertCount).toBe(1);
    expect(mockTenantMgr.markInitialized).toHaveBeenCalled();
  });
});
