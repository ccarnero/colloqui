import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ChannelAuditMongoRepository } from "../../src/modules/channel-audit/channel-audit.mongo.repository";
import { ChannelAuditPostgresRepository } from "../../src/modules/channel-audit/channel-audit.postgres.repository";
import {
  CHANNEL_AUDIT_REPOSITORY,
} from "../../src/modules/channel-audit/channel-audit.repository.interface";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeMongoCollectionMock,
  makeMockDb,
} from "../make-mongo-mock";

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
      }),
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
    const makeSqlTag = (): (
      (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
    ) & { unsafe: (s: string) => string } => {
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
