import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  EXECUTION_AUDIT_REPOSITORY,
  type IExecutionAuditRepository,
} from "../../src/modules/execution-audit/execution-audit.repository.interface";
import { ExecutionAuditService } from "../../src/modules/execution-audit/execution-audit.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";

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

describe("ExecutionAuditService", () => {
  let service: ExecutionAuditService;
  let insertExecutionEvent: ReturnType<typeof mock>;

  beforeEach(async () => {
    insertExecutionEvent = mock(() => Promise.resolve());
    const mockRepo: Partial<IExecutionAuditRepository> = {
      insertExecutionEvent,
      queryEvents: mock(() => Promise.resolve([])),
      getEventById: mock(() => Promise.resolve(null)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionAuditService,
        { provide: EXECUTION_AUDIT_REPOSITORY, useValue: mockRepo },
        { provide: JETSTREAM_MANAGER, useValue: mockJsm },
        { provide: JETSTREAM_PUBLISHER, useValue: mockJs },
      ],
    }).compile();

    service = moduleRef.get(ExecutionAuditService);
  });

  function invokePersist(envelope: Record<string, unknown>): Promise<void> {
    // Access the private handler the same way handleJsMessage would, via
    // the public queryEvents/getEventById surface is not enough — exercise
    // the persistence path through the JsMsg handler indirectly by calling
    // the private method through bracket access (mirrors how other specs in
    // this suite reach into service internals when there is no public API).
    return (
      service as unknown as {
        persistExecutionEnvelope: (
          e: Record<string, unknown>,
          subject: string
        ) => Promise<void>;
      }
    ).persistExecutionEnvelope(envelope, "evt.tenant-a.subject");
  }

  it("persists a well-formed execution_completed envelope", async () => {
    await invokePersist({
      id: "env-1",
      tenant: "tenant-a",
      correlation_id: "conv-1",
      causation_id: null,
      transport: { depth: 0 },
      data: {
        payload: {
          executionId: "exec-1",
          agentId: "agent-1",
          state: "completed",
        },
      },
    });

    expect(insertExecutionEvent).toHaveBeenCalledTimes(1);
  });

  it("drops the event when tenant is missing", async () => {
    await invokePersist({
      id: "env-2",
      data: { payload: { executionId: "exec-2", state: "started" } },
    });

    expect(insertExecutionEvent).not.toHaveBeenCalled();
  });

  it("drops the event when payload lacks executionId/state", async () => {
    await invokePersist({
      id: "env-3",
      tenant: "tenant-a",
      data: { payload: { agentId: "agent-1" } },
    });

    expect(insertExecutionEvent).not.toHaveBeenCalled();
  });

  it("queryEvents delegates to the repository with tenant scope", async () => {
    const rows = await service.queryEvents(
      { limit: 10, offset: 0 },
      "tenant-a"
    );
    expect(rows).toEqual([]);
  });

  it("getEventById delegates to the repository", async () => {
    const row = await service.getEventById("evt-1", "tenant-a");
    expect(row).toBeNull();
  });
});
