import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { EventEnvelope } from "@yoizen/shared";
import type { IExecutionLifecyclePayload } from "../../src/common/execution-audit-projection";
import { ExecutionAuditMongoRepository } from "../../src/modules/execution-audit/execution-audit.mongo.repository";
import { ExecutionAuditPostgresRepository } from "../../src/modules/execution-audit/execution-audit.postgres.repository";
import { EXECUTION_AUDIT_REPOSITORY } from "../../src/modules/execution-audit/execution-audit.repository.interface";
import { AuditTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeMockDb,
  makeMongoCollectionMock,
} from "../make-mongo-mock";

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    specversion: "1.0",
    id: "env-exec-1",
    source: "agent-ai-service",
    type: "io.yoizen.platform.runtime.execution_completed.v1",
    resource: "execution/exec-1",
    time: "2026-07-07T00:00:00.000Z",
    traceid: "trace-1",
    causation_id: "caus-1",
    correlation_id: "conv-1",
    tenant: "tenant-a",
    producer: "agent-ai-service",
    domain: "automation",
    channel: "platform",
    provider: "internal",
    accountid: "",
    idempotencykey: "idem-1",
    transport: { method: "internal" as never, protocol: "internal", depth: 2 },
    data: {
      received_at: "2026-07-07T00:00:00.000Z",
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "chk",
      payload: null,
    },
    ...overrides,
  };
}

const completedPayload: IExecutionLifecyclePayload = {
  executionId: "exec-1",
  agentId: "agent-1",
  tenantId: "tenant-a",
  state: "completed",
  response: "hi",
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  costUsd: 0.001,
  model: "gpt-4o",
  provider: "openai",
};

// ---------------------------------------------------------------------------
// Postgres repo tests
// ---------------------------------------------------------------------------

describe("ExecutionAuditPostgresRepository.insertExecutionEvent", () => {
  it("inserts with ON CONFLICT (id) DO NOTHING keyed by envelope id (idempotent)", async () => {
    const capturedStrings: string[] = [];
    const capturedValues: unknown[] = [];

    const makeSqlTag = (): ((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>) & { unsafe: (s: string) => string } => {
      const tag = async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown[]> => {
        capturedStrings.push(strings.join("?"));
        capturedValues.push(...values);
        return [];
      };
      tag.unsafe = (s: string) => s;
      return tag as ReturnType<typeof makeSqlTag>;
    };

    const sqlTag = makeSqlTag();
    const mockTenantMgr = {
      getConnection: mock(() => sqlTag),
      isInitialized: mock(() => true),
      markInitialized: mock(),
      isNamespaceInitialized: mock(() => true),
      markNamespaceInitialized: mock(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionAuditPostgresRepository,
        {
          provide: EXECUTION_AUDIT_REPOSITORY,
          useExisting: ExecutionAuditPostgresRepository,
        },
        { provide: AuditTenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    const repo = moduleRef.get(ExecutionAuditPostgresRepository);
    const envelope = makeEnvelope();

    await repo.insertExecutionEvent(envelope, completedPayload, "evt.subject");
    await repo.insertExecutionEvent(envelope, completedPayload, "evt.subject");

    const fullQuery = capturedStrings.join(" ");
    expect(fullQuery).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    // envelope.id is the PK value bound on every insert call — same id both times.
    expect(capturedValues.filter((v) => v === "env-exec-1")).toHaveLength(2);
    expect(capturedValues).toContain("conv-1");
    expect(capturedValues).toContain("exec-1");
    expect(capturedValues).toContain("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// Mongo repo tests
// ---------------------------------------------------------------------------

describe("ExecutionAuditMongoRepository.insertExecutionEvent", () => {
  it("same envelope id inserted twice results in exactly one persisted row (idempotent)", async () => {
    const store = new Map<string, Record<string, unknown>>();

    const insertMany = mock(async (docs: Array<Record<string, unknown>>) => {
      for (const doc of docs) {
        const id = String(doc._id);
        if (store.has(id)) {
          const err = new Error("duplicate key") as Error & {
            code: number;
          };
          err.code = 11000;
          throw err;
        }
        store.set(id, doc);
      }
      return { insertedCount: docs.length };
    });

    const collection = makeMongoCollectionMock({ insertMany });

    const mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        execution_events: collection as unknown as Record<string, unknown>,
      })
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionAuditMongoRepository,
        {
          provide: EXECUTION_AUDIT_REPOSITORY,
          useExisting: ExecutionAuditMongoRepository,
        },
        { provide: AuditTenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    const repo = moduleRef.get(ExecutionAuditMongoRepository);
    const envelope = makeEnvelope();

    await repo.insertExecutionEvent(envelope, completedPayload, "evt.subject");
    await repo.insertExecutionEvent(envelope, completedPayload, "evt.subject");

    expect(store.size).toBe(1);
    expect(insertMany).toHaveBeenCalledTimes(2);
    const persisted = store.get("env-exec-1");
    expect(persisted?.execution_id).toBe("exec-1");
    expect(persisted?.conversation_id).toBe("conv-1");
    expect(persisted?.input_tokens).toBe(10);
    expect(persisted?.cost_usd).toBe(0.001);
  });

  it("propagates non-duplicate errors", async () => {
    const insertMany = mock(async () => {
      throw new Error("connection lost");
    });
    const collection = makeMongoCollectionMock({ insertMany });
    const mockTenantMgr = makeFakeTenantMongoConnections(
      makeMockDb({
        execution_events: collection as unknown as Record<string, unknown>,
      })
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionAuditMongoRepository,
        {
          provide: EXECUTION_AUDIT_REPOSITORY,
          useExisting: ExecutionAuditMongoRepository,
        },
        { provide: AuditTenantConnectionManager, useValue: mockTenantMgr },
      ],
    }).compile();

    const repo = moduleRef.get(ExecutionAuditMongoRepository);
    await expect(
      repo.insertExecutionEvent(makeEnvelope(), completedPayload, "evt.subject")
    ).rejects.toThrow("connection lost");
  });
});
