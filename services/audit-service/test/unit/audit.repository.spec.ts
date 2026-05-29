import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { EventEnvelope } from "@yoizen/shared";
import { AuditMongoRepository } from "../../src/modules/audit/audit.mongo.repository";
import {
  AUDIT_REPOSITORY,
  type IAuditRepository,
} from "../../src/modules/audit/audit.repository.interface";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeMongoCollectionMock,
  makeMockDb,
} from "../make-mongo-mock";

describe("AuditMongoRepository", () => {
  let repo: IAuditRepository;
  let insertMany: ReturnType<typeof mock>;
  let findChain: ReturnType<typeof mock>;
  let mockTenantMgr: ReturnType<typeof makeFakeTenantMongoConnections>;

  const sampleEvent = {
    _id: "evt-1",
    type: "user.created",
    payload: { a: 1 },
    metadata: { tenant: "t1" },
    subject: "events.user",
    created_at: new Date(),
  };

  beforeEach(async () => {
    insertMany = mock(async () => ({ insertedCount: 1 }));
    findChain = mock(() => ({
      sort: mock(() => ({
        skip: mock(() => ({
          limit: mock(() => ({
            toArray: mock(async () => [sampleEvent]),
          })),
        })),
      })),
    }));

    const collection = makeMongoCollectionMock({
      insertMany,
      find: findChain,
      findOne: mock(async () => sampleEvent),
    });

    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({ events: collection as unknown as Record<string, unknown> }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditMongoRepository,
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
        {
          provide: AUDIT_REPOSITORY,
          useExisting: AuditMongoRepository,
        },
      ],
    }).compile();

    repo = moduleRef.get(AUDIT_REPOSITORY);
  });

  it("queryEvents returns rows and passes tenant connection", async () => {
    const rows = await repo.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("evt-1");
    expect(mockTenantMgr.ensureSchemaCalls.get("tenant-a")).toBe(1);
  });

  it("queryEvents applies type filter when provided", async () => {
    const find = mock((filter: { type?: string }) => {
      expect(filter.type).toBe("login");
      return {
        sort: mock(() => ({
          skip: mock(() => ({
            limit: mock(() => ({
              toArray: mock(async () => [sampleEvent]),
            })),
          })),
        })),
      };
    });

    const collection = makeMongoCollectionMock({
      insertMany,
      find,
      findOne: mock(async () => null),
    });
    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({ events: collection as unknown as Record<string, unknown> }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditMongoRepository,
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
        {
          provide: AUDIT_REPOSITORY,
          useExisting: AuditMongoRepository,
        },
      ],
    }).compile();
    repo = moduleRef.get(AUDIT_REPOSITORY);

    await repo.queryEvents({ type: "login", limit: 5, offset: 0 }, "t1");
    expect(find).toHaveBeenCalled();
  });

  it("getEventById returns null when empty", async () => {
    const collection = makeMongoCollectionMock({
      insertMany,
      find: findChain,
      findOne: mock(async () => null),
    });
    mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({ events: collection as unknown as Record<string, unknown> }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditMongoRepository,
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
        {
          provide: AUDIT_REPOSITORY,
          useExisting: AuditMongoRepository,
        },
      ],
    }).compile();
    repo = moduleRef.get(AUDIT_REPOSITORY);

    const row = await repo.getEventById("missing", "tenant-a");
    expect(row).toBeNull();
  });

  it("insertAuditEvent runs insertMany with envelope fields", async () => {
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
    expect(insertMany).toHaveBeenCalledTimes(1);
    const docs = insertMany.mock.calls[0]?.[0] as unknown[];
    expect(Array.isArray(docs)).toBe(true);
    expect((docs[0] as { _id: string })._id).toBe("e1");
  });

  it("insertAuditEvent ignores duplicate key errors", async () => {
    insertMany.mockImplementation(async () => {
      const error = { code: 11000 };
      throw error;
    });

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id: "e-dup",
      source: "src",
      type: "t",
      resource: "r",
      time: new Date().toISOString(),
      traceid: "tr",
      causation_id: null,
      correlation_id: "c",
      tenant: "tenant-a",
      data: { payload: {} },
    };

    await expect(
      repo.insertAuditEvent("tenant-a", envelope, "subj"),
    ).resolves.toBeUndefined();
  });
});
