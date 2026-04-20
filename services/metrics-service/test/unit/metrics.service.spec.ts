import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { MetricsRepository } from "../../src/modules/metrics/metrics.repository";
import {
  MetricsService,
  type IMetricRecord,
} from "../../src/modules/metrics/metrics.service";
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
const mockJs = {
  consumers: { get: mock(() => Promise.reject(new Error("skip"))) },
};

describe("MetricsService", () => {
  let service: MetricsService;
  let mockSql: Sql;
  let mockTenantMgr: {
    getConnection: ReturnType<typeof mock>;
    isInitialized: ReturnType<typeof mock>;
    markInitialized: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const sample: IMetricRecord = {
      id: "m-1",
      source: "api",
      name: "latency",
      value: 12.5,
      tags: { env: "test" },
      metadata: {},
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
        MetricsRepository,
        MetricsService,
        { provide: NATS_CONNECTION, useValue: mockNatsConnection },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    service = moduleRef.get(MetricsService);
  });

  it("queryMetrics returns rows from SQL", async () => {
    const rows = await service.queryMetrics(
      { limit: 5, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("latency");
    expect(mockTenantMgr.getConnection).toHaveBeenCalledWith("tenant-a");
  });

  it("getMetricById returns a row when present", async () => {
    const row = await service.getMetricById("m-1", "tenant-a");
    expect(row).not.toBeNull();
    expect(row?.source).toBe("api");
  });

  it("getMetricById returns null when no row", async () => {
    const emptySql = Object.assign(() => Promise.resolve([]), {}) as Sql;
    mockTenantMgr.getConnection.mockReturnValue(emptySql);

    const row = await service.getMetricById("missing", "tenant-a");
    expect(row).toBeNull();
  });

  it("persistMetricEnvelopeForTest inserts when tenant present", async () => {
    let insertCount = 0;
    const trackingSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        const head = _strings[0] ?? "";
        if (head.includes("INSERT INTO metrics")) {
          insertCount += 1;
        }
        return Promise.resolve([]);
      },
      {},
    ) as Sql;

    mockTenantMgr.getConnection.mockReturnValue(trackingSql);

    await service.persistMetricEnvelopeForTest({
      specversion: "1.0",
      id: "m-evt-1",
      source: "s",
      type: "metric",
      resource: "r",
      time: new Date().toISOString(),
      traceid: "t",
      causation_id: null,
      correlation_id: "c",
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
        payload: {
          source: "api",
          name: "hits",
          value: 3,
          tags: {},
          timestamp: new Date().toISOString(),
        },
      },
    });

    expect(insertCount).toBe(1);
  });
});
