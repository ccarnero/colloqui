import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { EventEnvelope } from "@yoizen/shared";
import { AuditMongoRepository } from "../../src/modules/audit/audit.mongo.repository";
import {
  AUDIT_REPOSITORY,
} from "../../src/modules/audit/audit.repository.interface";
import {
  AuditService,
  type IAuditEvent,
} from "../../src/modules/audit/audit.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
  NATS_CONNECTION,
} from "../../src/providers/nats.provider";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeMongoCollectionMock,
  makeMockDb,
} from "../make-mongo-mock";

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

describe("AuditService", () => {
  let service: AuditService;
  let insertMany: ReturnType<typeof mock>;
  let mockTenantMgr: ReturnType<typeof makeFakeTenantMongoConnections>;

  beforeEach(async () => {
    const sample: IAuditEvent = {
      id: "evt-1",
      type: "user.created",
      payload: { a: 1 },
      metadata: { tenant: "t1" },
      subject: "events.user",
      created_at: new Date().toISOString(),
      correlation_id: "co",
      causation_id: null,
      depth: 0,
    };

    insertMany = mock(async () => ({ insertedCount: 1 }));
    const sampleDoc = {
      _id: sample.id,
      type: sample.type,
      payload: sample.payload,
      metadata: sample.metadata,
      subject: sample.subject,
      created_at: new Date(sample.created_at),
      correlation_id: "co",
      causation_id: null,
      depth: 0,
    };
    const collection = makeMongoCollectionMock({
      insertMany,
      find: mock(() => ({
        sort: mock(() => ({
          skip: mock(() => ({
            limit: mock(() => ({
              toArray: mock(async () => [sampleDoc]),
            })),
          })),
          limit: mock(() => ({
            toArray: mock(async () => [sampleDoc]),
          })),
          toArray: mock(async () => [sampleDoc]),
        })),
      })),
      findOne: mock(async (filter: { _id?: string }) =>
        filter._id === "missing"
          ? null
          : {
              _id: sample.id,
              type: sample.type,
              payload: sample.payload,
              metadata: sample.metadata,
              subject: sample.subject,
              created_at: new Date(sample.created_at),
              correlation_id: "co",
              causation_id: null,
              depth: 0,
            },
      ),
    });

    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({ events: collection as unknown as Record<string, unknown> }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditMongoRepository,
        {
          provide: AUDIT_REPOSITORY,
          useExisting: AuditMongoRepository,
        },
        AuditService,
        { provide: NATS_CONNECTION, useValue: mockNatsConnection },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
  });

  it("queryEvents returns rows from Mongo", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("evt-1");
    expect(mockTenantMgr.ensureSchemaCalls.get("tenant-a")).toBe(1);
  });

  it("getEventById returns a row when present", async () => {
    const row = await service.getEventById("evt-1", "tenant-a");
    expect(row).not.toBeNull();
    expect(row?.type).toBe("user.created");
  });

  it("getEventById returns null when no row", async () => {
    const row = await service.getEventById("missing", "tenant-a");
    expect(row).toBeNull();
  });

  it("getChain returns assembled tree when events found", async () => {
    const chain = await service.getChain("co", "tenant-a");
    expect(chain).not.toBeNull();
    expect(chain!.correlation_id).toBe("co");
    expect(chain!.root.id).toBe("evt-1");
  });

  it("getChain returns null when no events found", async () => {
    // Rebuild service with empty collection
    const emptyCollection = makeMongoCollectionMock({
      insertMany: mock(async () => ({ insertedCount: 0 })),
      find: mock(() => ({
        sort: mock(() => ({
          skip: mock(() => ({
            limit: mock(() => ({
              toArray: mock(async () => []),
            })),
          })),
          limit: mock(() => ({
            toArray: mock(async () => []),
          })),
          toArray: mock(async () => []),
        })),
      })),
      findOne: mock(async () => null),
    });
    const emptyMgr = makeFakeTenantMongoConnections(
      makeMockDb({ events: emptyCollection as unknown as Record<string, unknown> }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditMongoRepository,
        { provide: AUDIT_REPOSITORY, useExisting: AuditMongoRepository },
        AuditService,
        { provide: NATS_CONNECTION, useValue: mockNatsConnection },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
        { provide: AuditTenantConnectionManager, useValue: emptyMgr },
      ],
    }).compile();
    const svc = moduleRef.get(AuditService);
    const result = await svc.getChain("unknown-corr", "tenant-a");
    expect(result).toBeNull();
  });

  it("persistAuditEnvelope inserts when tenant present", async () => {
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

    expect(insertMany).toHaveBeenCalledTimes(1);
  });
});
