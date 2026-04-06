import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { EventEnvelope } from "@yoizen/shared";
import { MetricsRepository } from "../../src/modules/metrics/metrics.repository";
import {
  TenantConnectionManager,
  type Sql,
} from "@yoizen/database";

describe("MetricsRepository", () => {
  let repo: MetricsRepository;
  let mockSql: Sql;
  let mockTenantMgr: {
    isInitialized: ReturnType<typeof mock>;
    markInitialized: ReturnType<typeof mock>;
  };

  const sampleMetric = {
    id: "m-1",
    source: "api",
    name: "latency",
    value: 1,
    tags: {},
    metadata: {},
    created_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve([sampleMetric]),
      {
        unsafe: mock(() => Promise.resolve(undefined)),
      },
    ) as Sql;

    mockTenantMgr = {
      isInitialized: mock(() => true),
      markInitialized: mock(() => {}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MetricsRepository,
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    repo = moduleRef.get(MetricsRepository);
  });

  it("ensureTable skips DDL when already initialized", async () => {
    let unsafeCalls = 0;
    const sql = Object.assign(
      () => Promise.resolve([]),
      {
        unsafe: mock(() => {
          unsafeCalls += 1;
          return Promise.resolve(undefined);
        }),
      },
    ) as Sql;

    await repo.ensureTable(sql, "t1");
    expect(unsafeCalls).toBe(0);
    expect(mockTenantMgr.markInitialized).not.toHaveBeenCalled();
  });

  it("ensureTable runs METRICS_SCHEMA_SQL when not initialized", async () => {
    mockTenantMgr.isInitialized.mockReturnValue(false);
    let unsafeCalls = 0;
    const sql = Object.assign(
      () => Promise.resolve([]),
      {
        unsafe: mock(() => {
          unsafeCalls += 1;
          return Promise.resolve(undefined);
        }),
      },
    ) as Sql;

    await repo.ensureTable(sql, "t-new");
    expect(unsafeCalls).toBe(1);
    expect(mockTenantMgr.markInitialized).toHaveBeenCalledWith("t-new");
  });

  it("queryMetrics returns rows", async () => {
    const rows = await repo.queryMetrics(mockSql, "t1", {
      limit: 10,
      offset: 0,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("latency");
  });

  it("getMetricById returns null when empty", async () => {
    const emptySql = Object.assign(
      () => Promise.resolve([]),
      { unsafe: mock(() => Promise.resolve(undefined)) },
    ) as Sql;

    const row = await repo.getMetricById(emptySql, "t1", "missing");
    expect(row).toBeNull();
  });

  it("insertMetricFromEnvelope inserts with defaults for missing payload", async () => {
    mockTenantMgr.isInitialized.mockReturnValue(true);
    let insertCalls = 0;
    const trackingSql = Object.assign(
      (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const head = strings[0] ?? "";
        if (head.includes("INSERT INTO metrics")) insertCalls += 1;
        return Promise.resolve([]);
      },
      {
        unsafe: mock(() => Promise.resolve(undefined)),
      },
    ) as Sql;

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id: "mid-1",
      source: "s",
      type: "metric",
      resource: "r",
      time: new Date().toISOString(),
      traceid: "tr",
      causation_id: null,
      correlation_id: null,
      tenant: "t1",
      data: { payload: {} },
    };

    await repo.insertMetricFromEnvelope(trackingSql, "t1", envelope);
    expect(insertCalls).toBe(1);
  });
});
