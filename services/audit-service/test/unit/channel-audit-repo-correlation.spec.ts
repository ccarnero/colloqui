import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { ChannelEnvelope } from "@yoizen/shared";
import { ChannelAuditMongoRepository } from "../../src/modules/channel-audit/channel-audit.mongo.repository";
import { ChannelAuditPostgresRepository } from "../../src/modules/channel-audit/channel-audit.postgres.repository";
import { CHANNEL_AUDIT_REPOSITORY } from "../../src/modules/channel-audit/channel-audit.repository.interface";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeMockDb,
  makeMongoCollectionMock,
} from "../make-mongo-mock";

function makeChannelEnvelope(
  overrides: Partial<ChannelEnvelope> = {}
): ChannelEnvelope {
  return {
    specversion: "1.0",
    id: "env-ch-1",
    source: "channel-service",
    type: "io.yoizen.messaging.telegram.telegram.received.v1",
    resource: "tenant/tenant-a/account/acc-1/channel/telegram/provider/telegram",
    time: "2026-07-07T00:00:00.000Z",
    traceid: "trace-1",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    channel: "telegram",
    provider: "telegram",
    accountid: "acc-1",
    idempotencykey: "idem-1",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: {
      received_at: "2026-07-07T00:00:00.000Z",
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "chk",
      payload: { conversationId: "conv-xyz" },
    },
    kind: "received",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mongo repo tests
// ---------------------------------------------------------------------------

describe("ChannelAuditMongoRepository.findByCorrelationId", () => {
  let findMock: ReturnType<typeof mock>;
  let sortMock: ReturnType<typeof mock>;
  let toArrayMock: ReturnType<typeof mock>;

  beforeEach(() => {
    toArrayMock = mock(async () => []);
    sortMock = mock(() => ({ toArray: toArrayMock }));
    findMock = mock(() => ({ sort: sortMock }));
  });

  it("calls collection.find with { correlation_id } and sort { created_at: 1 }", async () => {
    const collection = makeMongoCollectionMock({
      find: findMock,
    });

    const mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        channel_events: collection as unknown as Record<string, unknown>,
      })
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditMongoRepository,
        {
          provide: CHANNEL_AUDIT_REPOSITORY,
          useExisting: ChannelAuditMongoRepository,
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockTenantMgr,
        },
      ],
    }).compile();

    const repo = moduleRef.get(ChannelAuditMongoRepository);
    const result = await repo.findByCorrelationId("test-corr-id", "tenant-a");

    expect(result).toEqual([]);
    expect(findMock).toHaveBeenCalledWith({ correlation_id: "test-corr-id" });
    expect(sortMock).toHaveBeenCalledWith({ created_at: 1 });
    expect(toArrayMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Postgres repo tests
// ---------------------------------------------------------------------------

describe("ChannelAuditPostgresRepository.findByCorrelationId", () => {
  it("passes correlation_id filter and returns rows ordered by created_at ASC", async () => {
    // Capture the queries executed against the mock sql tagged template.
    const capturedStrings: string[] = [];
    const capturedValues: unknown[] = [];

    // Create a mock sql tagged template function that also supports sql.unsafe()
    const makeSqlTag = (): ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>) & { unsafe: (s: string) => string } => {
      const tag = async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown[]> => {
        const query = strings.join("?");
        capturedStrings.push(query);
        capturedValues.push(...values);
        return [];
      };
      tag.unsafe = (s: string) => s;
      return tag as ReturnType<typeof makeSqlTag>;
    };

    const sqlTag = makeSqlTag();

    // Minimal TenantConnectionManager stub for Postgres
    const mockPostgresTenantMgr = {
      getConnection: mock(() => sqlTag),
      isInitialized: mock(() => true),
      markInitialized: mock(),
      isNamespaceInitialized: mock(() => true),
      markNamespaceInitialized: mock(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditPostgresRepository,
        {
          provide: CHANNEL_AUDIT_REPOSITORY,
          useExisting: ChannelAuditPostgresRepository,
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockPostgresTenantMgr,
        },
      ],
    }).compile();

    const repo = moduleRef.get(ChannelAuditPostgresRepository);
    const result = await repo.findByCorrelationId("pg-corr-id", "tenant-pg");

    expect(result).toEqual([]);
    // Assert the correlation_id value was passed
    expect(capturedValues).toContain("pg-corr-id");
    // Assert the query string contains the ORDER BY clause
    const fullQuery = capturedStrings.join(" ");
    expect(fullQuery).toMatch(/ORDER BY created_at ASC/i);
  });
});

// ---------------------------------------------------------------------------
// conversationId projection (DOCS/archive/audits/METERING-FOUNDATION.md G3)
// ---------------------------------------------------------------------------

describe("ChannelAuditPostgresRepository.insertChannelEvent — conversationId", () => {
  it("extracts payload.conversationId into the conversation_id column", async () => {
    const capturedValues: unknown[] = [];
    const makeSqlTag = (): ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>) & { unsafe: (s: string) => string } => {
      const tag = async (
        _strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown[]> => {
        capturedValues.push(...values);
        return [];
      };
      tag.unsafe = (s: string) => s;
      return tag as ReturnType<typeof makeSqlTag>;
    };

    const sqlTag = makeSqlTag();
    const mockPostgresTenantMgr = {
      getConnection: mock(() => sqlTag),
      isInitialized: mock(() => true),
      markInitialized: mock(),
      isNamespaceInitialized: mock(() => true),
      markNamespaceInitialized: mock(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditPostgresRepository,
        {
          provide: CHANNEL_AUDIT_REPOSITORY,
          useExisting: ChannelAuditPostgresRepository,
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockPostgresTenantMgr,
        },
      ],
    }).compile();

    const repo = moduleRef.get(ChannelAuditPostgresRepository);
    await repo.insertChannelEvent(makeChannelEnvelope(), "ingress.subject");

    expect(capturedValues).toContain("conv-xyz");
  });

  it("leaves conversation_id null when payload has no conversationId", async () => {
    const capturedValues: unknown[] = [];
    const makeSqlTag = (): ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>) & { unsafe: (s: string) => string } => {
      const tag = async (
        _strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown[]> => {
        capturedValues.push(...values);
        return [];
      };
      tag.unsafe = (s: string) => s;
      return tag as ReturnType<typeof makeSqlTag>;
    };

    const sqlTag = makeSqlTag();
    const mockPostgresTenantMgr = {
      getConnection: mock(() => sqlTag),
      isInitialized: mock(() => true),
      markInitialized: mock(),
      isNamespaceInitialized: mock(() => true),
      markNamespaceInitialized: mock(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditPostgresRepository,
        {
          provide: CHANNEL_AUDIT_REPOSITORY,
          useExisting: ChannelAuditPostgresRepository,
        },
        {
          provide: AuditTenantConnectionManager,
          useValue: mockPostgresTenantMgr,
        },
      ],
    }).compile();

    const repo = moduleRef.get(ChannelAuditPostgresRepository);
    const envelope = makeChannelEnvelope({
      data: {
        received_at: "2026-07-07T00:00:00.000Z",
        payload_inline: true,
        payload_ref: null,
        payload_bytes: 0,
        payload_checksum: "chk",
        payload: {},
      },
    });
    await repo.insertChannelEvent(envelope, "ingress.subject");

    expect(capturedValues).not.toContain("conv-xyz");
  });
});

describe("ChannelAuditMongoRepository.insertChannelEvent — conversationId", () => {
  it("extracts payload.conversationId into the conversation_id field", async () => {
    let insertedDoc: Record<string, unknown> | undefined;
    const insertMany = mock(async (docs: Array<Record<string, unknown>>) => {
      insertedDoc = docs[0];
      return { insertedCount: docs.length };
    });
    const collection = makeMongoCollectionMock({ insertMany });

    const mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        channel_events: collection as unknown as Record<string, unknown>,
      })
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelAuditMongoRepository,
        {
          provide: CHANNEL_AUDIT_REPOSITORY,
          useExisting: ChannelAuditMongoRepository,
        },
        { provide: AuditTenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    const repo = moduleRef.get(ChannelAuditMongoRepository);
    await repo.insertChannelEvent(makeChannelEnvelope(), "ingress.subject");

    expect(insertedDoc?.conversation_id).toBe("conv-xyz");
  });
});
