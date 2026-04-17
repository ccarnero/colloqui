import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Msg, NatsConnection } from "nats";
import { CHANNEL_AUDIT_SUBJECT_PATTERN } from "@yoizen/shared";
import { ChannelAuditService } from "../../src/modules/channel-audit/channel-audit.service";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";
import { TenantConnectionManager, type Sql } from "@yoizen/database";

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

    const mockNc = {
      subscribe: mock(() => ({
        unsubscribe: mock(),
      })),
    } as unknown as NatsConnection;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditService,
        { provide: NATS_CONNECTION, useValue: mockNc },
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

describe("ChannelAuditService NATS ingest", () => {
  it("persists envelope from subscription callback", async () => {
    let natsCallback: ((err: Error | null, msg: Msg) => void) | undefined;
    const mockNc = {
      subscribe: mock(
        (pattern: string, opts: { callback: typeof natsCallback }) => {
          expect(pattern).toBe(CHANNEL_AUDIT_SUBJECT_PATTERN);
          natsCallback = opts.callback;
          return { unsubscribe: mock() };
        },
      ),
    } as unknown as NatsConnection;

    let insertCount = 0;
    const mockSql = Object.assign(
      (strings: TemplateStringsArray) => {
        const h = strings[0] ?? "";
        if (h.includes("CREATE TABLE") || h.includes("CREATE INDEX")) {
          return Promise.resolve([]);
        }
        if (h.includes("INSERT INTO channel_events")) {
          insertCount += 1;
        }
        return Promise.resolve([]);
      },
      { unsafe: (s: string) => s },
    ) as Sql;

    const tenantId = `t_nats_${Math.random().toString(36).slice(2)}`;
    const mockTenantMgr = {
      getConnection: mock(() => mockSql),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditService,
        { provide: NATS_CONNECTION, useValue: mockNc },
        { provide: TenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    const svc = moduleRef.get(ChannelAuditService);
    await svc.onModuleInit();

    expect(natsCallback).toBeDefined();

    const envelope = {
      id: "evt-nats-1",
      specversion: "1.0" as const,
      type: "channel.message",
      source: "channel-service",
      time: new Date().toISOString(),
      data: {
        accountId: "acc1",
        type: "text",
        text: "hello",
        providerMessageId: "pm1",
      },
      idempotencykey: "ik1",
      tenant: tenantId,
      channel: "whatsapp" as const,
      provider: "meta" as const,
      kind: "received" as const,
    };

    await natsCallback!(null, {
      data: new TextEncoder().encode(JSON.stringify(envelope)),
      subject: "audit.channel.test",
    } as Msg);

    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    expect(insertCount).toBe(1);
    expect(mockTenantMgr.getConnection).toHaveBeenCalledWith(tenantId);
  });
});
