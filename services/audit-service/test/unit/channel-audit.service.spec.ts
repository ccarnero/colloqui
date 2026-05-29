import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ChannelAuditService } from "../../src/modules/channel-audit/channel-audit.service";
import { ChannelAuditMongoRepository } from "../../src/modules/channel-audit/channel-audit.mongo.repository";
import {
  CHANNEL_AUDIT_REPOSITORY,
} from "../../src/modules/channel-audit/channel-audit.repository.interface";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeMongoCollectionMock,
  makeMockDb,
} from "../make-mongo-mock";

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
  let mockTenantMgr: ReturnType<typeof makeFakeTenantMongoConnections>;

  const sampleRow = {
    _id: "evt-1",
    tenant_id: "t1",
    channel: "whatsapp",
    provider: "meta",
    kind: "inbound",
    account_id: "acc",
    from_id: "f1",
    to_id: "t2",
    message_type: "text",
    message_text: "hi",
    provider_message_id: "pm1",
    data: {},
    nats_subject: "sub",
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
    });

    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        channel_events: collection as unknown as Record<string, unknown>,
      }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditMongoRepository,
        {
          provide: CHANNEL_AUDIT_REPOSITORY,
          useExisting: ChannelAuditMongoRepository,
        },
        ChannelAuditService,
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
      ],
    }).compile();

    service = moduleRef.get(ChannelAuditService);
  });

  it("queryEvents returns rows from tenant Mongo", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("evt-1");
    expect(mockTenantMgr.ensureSchemaCalls.get("tenant-a")).toBe(1);
  });

  it("getEventById returns first row", async () => {
    const row = await service.getEventById("evt-1", "tenant-a");
    expect(row?.id).toBe("evt-1");
  });
});
