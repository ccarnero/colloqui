import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { EventEnvelope } from "@yoizen/shared";
import { AuditRepository } from "../../src/modules/audit/audit.repository";
import { TenantConnectionManager, type Sql } from "@yoizen/database";

describe("AuditRepository", () => {
  let repo: AuditRepository;
  let mockSql: Sql;
  let mockTenantMgr: {
    getConnection: ReturnType<typeof mock>;
    isInitialized: ReturnType<typeof mock>;
    markInitialized: ReturnType<typeof mock>;
  };

  const sampleEvent = {
    id: "evt-1",
    type: "user.created",
    payload: { a: 1 },
    metadata: { tenant: "t1" },
    subject: "events.user",
    created_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve([sampleEvent]),
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
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    repo = moduleRef.get(AuditRepository);
  });

  it("queryEvents returns rows and passes tenant connection", async () => {
    const rows = await repo.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("evt-1");
    expect(mockTenantMgr.getConnection).toHaveBeenCalledWith("tenant-a");
  });

  it("queryEvents applies type filter when provided", async () => {
    let sawType = false;
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const head = strings.join("");
        if (values.some((v) => v === "login")) sawType = true;
        if (head.includes("AND type =")) {
          /* filter branch */
        }
        return Promise.resolve([sampleEvent]);
      },
      {},
    ) as Sql;
    mockTenantMgr.getConnection.mockReturnValue(sql);

    await repo.queryEvents(
      { type: "login", limit: 5, offset: 0 },
      "t1",
    );
    expect(sawType).toBe(true);
  });

  it("getEventById returns null when empty", async () => {
    const emptySql = Object.assign(() => Promise.resolve([]), {}) as Sql;
    mockTenantMgr.getConnection.mockReturnValue(emptySql);

    const row = await repo.getEventById("missing", "tenant-a");
    expect(row).toBeNull();
  });

  it("insertAuditEvent runs INSERT with envelope fields", async () => {
    let insertCalls = 0;
    const trackingSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const head = strings[0] ?? "";
        if (head.includes("INSERT INTO events")) insertCalls += 1;
        return Promise.resolve([]);
      },
      {},
    ) as Sql;
    mockTenantMgr.getConnection.mockReturnValue(trackingSql);

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id: "e1",
      source: "src",
      type: "t",
      resource: "r",
      time: new Date().toISOString(),
      traceid: "tr",
      causation_id: null,
      correlation_id: "c",
      tenant: "tenant-a",
      data: { payload: { x: 1 } },
    };

    await repo.insertAuditEvent("tenant-a", envelope, "subj");
    expect(insertCalls).toBe(1);
  });
});
