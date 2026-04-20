import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ChannelAuditService } from "../../src/modules/channel-audit/channel-audit.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";
import { TenantConnectionManager, type Sql } from "@yoizen/database";

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

describe("ChannelAuditService", () => {
  let service: ChannelAuditService;
  let mockTenantMgr: { getConnection: ReturnType<typeof mock> };

  const sampleRow = {
    id: "evt-1",
    tenantId: "t1",
    channel: "whatsapp",
    provider: "meta",
    kind: "inbound",
    accountId: "acc",
    fromId: "f1",
    toId: "t2",
    messageType: "text",
    messageText: "hi",
    providerMessageId: "pm1",
    data: {},
    natsSubject: "sub",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(async () => {
    const mockSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve([sampleRow]),
      { unsafe: (s: string) => s },
    ) as Sql;

    mockTenantMgr = {
      getConnection: mock(() => mockSql),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditService,
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    service = moduleRef.get(ChannelAuditService);
  });

  it("queryEvents returns rows from tenant SQL", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("evt-1");
    expect(mockTenantMgr.getConnection).toHaveBeenCalledWith("tenant-a");
  });

  it("getEventById returns first row", async () => {
    const row = await service.getEventById("evt-1", "tenant-a");
    expect(row?.id).toBe("evt-1");
  });
});
