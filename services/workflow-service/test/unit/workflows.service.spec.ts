import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  ConflictException,
  GoneException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WorkflowNotFoundError as TemporalWorkflowNotFoundError } from "@temporalio/common";
import type { WorkflowAction } from "@yoizen/shared";
import { WorkflowStatus } from "@yoizen/shared";
import { EXECUTIONS_REPOSITORY, type IWorkflowExecutionRow } from "../../src/modules/workflows/executions.repository.interface";
import { RegisteredServicesResolver } from "../../src/modules/workflows/registered-services.resolver";
import { SystemVariablesProvider } from "../../src/modules/workflows/system-variables.provider";
import {
  type IWorkflowDefinitionRow,
  WORKFLOWS_REPOSITORY,
  WorkflowNotFoundError,
} from "../../src/modules/workflows/workflows.repository.interface";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service";
import { TEMPORAL_CLIENT } from "../../src/providers/temporal.provider";

/** Builds an `AsyncIterable` from a plain array, mirroring the shape of
 * `Client.workflow.list()`'s `AsyncWorkflowListIterable`. */
async function* asyncIterableOf<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

const ownedRow = (temporalWorkflowId: string, definitionId = "def-1"): IWorkflowExecutionRow => ({
  id: temporalWorkflowId, definition_id: definitionId, temporal_workflow_id: temporalWorkflowId,
  temporal_run_id: "stored-run", correlation_id: null, request: {}, status: "COMPLETED",
  created_at: new Date("2026-09-05T00:00:00Z"), updated_at: new Date("2026-09-05T00:00:00Z"),
});

describe("WorkflowsService", () => {
  const actions: WorkflowAction[] = [
    { activity: "jsFunction", name: "n1", args: { code: "return 1" } },
  ];

  const baseRow: IWorkflowDefinitionRow = {
    id: "def-1",
    name: "My workflow",
    application: "orders",
    actions,
    trigger: null,
    status: WorkflowStatus.ENABLED,
    created_at: new Date("2024-06-01T00:00:00.000Z"),
    updated_at: new Date("2024-06-01T00:00:00.000Z"),
    deleted_at: null,
  };

  let service: WorkflowsService;
  let mockTemporal: {
    workflow: {
      start: ReturnType<typeof mock>;
      getHandle: ReturnType<typeof mock>;
      list: ReturnType<typeof mock>;
    };
  };
  let mockDefinitions: {
    createDefinition: ReturnType<typeof mock>;
    findDefinitionById: ReturnType<typeof mock>;
    findDefinitionsByTenant: ReturnType<typeof mock>;
    softDeleteDefinition: ReturnType<typeof mock>;
    setStatus: ReturnType<typeof mock>;
  };
  let mockExecutions: {
    createExecution: ReturnType<typeof mock>;
    findExecutionsByDefinition: ReturnType<typeof mock>;
    countExecutionsByDefinition: ReturnType<typeof mock>;
    countExecutionsGroupedByDefinition: ReturnType<typeof mock>;
    findExecutionById: ReturnType<typeof mock>;
    updateExecutionStatus: ReturnType<typeof mock>;
    findCorrelationIdsByDefinition: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const mockHandle = {
      describe: mock(() => Promise.resolve({ status: { name: "COMPLETED" } })),
      result: mock(() => Promise.resolve({ ok: true })),
      terminate: mock(() => Promise.resolve()),
    };
    mockTemporal = {
      workflow: {
        start: mock(() => Promise.resolve({ firstExecutionRunId: "run-xyz" })),
        getHandle: mock(() => mockHandle),
        list: mock(() => asyncIterableOf([])),
      },
    };

    mockDefinitions = {
      createDefinition: mock(
        (params: {
          id: string;
          tenantId: string;
          name: string;
          application: string;
          actions: unknown[];
        }) =>
          Promise.resolve({
            ...baseRow,
            id: params.id,
            name: params.name,
            application: params.application,
            actions: params.actions,
          })
      ),
      findDefinitionById: mock(() => Promise.resolve(baseRow)),
      findDefinitionsByTenant: mock(() => Promise.resolve([baseRow])),
      softDeleteDefinition: mock(() => Promise.resolve(true)),
      setStatus: mock((_tenantId: string, _id: string, status: string) =>
        Promise.resolve({ ...baseRow, status })
      ),
    };
    mockExecutions = {
      createExecution: mock(
        (params: {
          id: string;
          definitionId: string;
          tenantId: string;
          temporalWorkflowId: string;
          temporalRunId: string;
          request: Record<string, unknown>;
        }) =>
          Promise.resolve({
            id: params.id,
            definition_id: params.definitionId,
            temporal_workflow_id: params.temporalWorkflowId,
            temporal_run_id: params.temporalRunId,
            request: params.request,
            status: "RUNNING",
            created_at: new Date(),
            updated_at: new Date(),
          })
      ),
      findExecutionsByDefinition: mock(() =>
        Promise.resolve([
          {
            id: "ex-1",
            definition_id: "def-1",
            temporal_workflow_id: "tw-1",
            temporal_run_id: "run-1",
            request: {},
            status: "RUNNING",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ])
      ),
      countExecutionsByDefinition: mock(() => Promise.resolve(1)),
      countExecutionsGroupedByDefinition: mock(() =>
        Promise.resolve([{ definition_id: "def-1", count: 3 }])
      ),
      findExecutionById: mock(() =>
        Promise.resolve({
          id: "ex-1",
          definition_id: "def-1",
          temporal_workflow_id: "tw-1",
          temporal_run_id: "run-1",
          request: {},
          status: "RUNNING",
          created_at: new Date(),
          updated_at: new Date(),
        })
      ),
      updateExecutionStatus: mock(() => Promise.resolve()),
      findCorrelationIdsByDefinition: mock(() =>
        Promise.resolve(["corr-1", "corr-2"])
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: TEMPORAL_CLIENT, useValue: mockTemporal },
        { provide: WORKFLOWS_REPOSITORY, useValue: mockDefinitions },
        { provide: EXECUTIONS_REPOSITORY, useValue: mockExecutions },
        {
          provide: RegisteredServicesResolver,
          useValue: { resolveSlugs: mock(() => Promise.resolve(new Map())) },
        },
        {
          provide: SystemVariablesProvider,
          useValue: { loadForTenant: mock(() => Promise.resolve({})) },
        },
      ],
    }).compile();

    service = moduleRef.get(WorkflowsService);
  });

  it("createWorkflow persists via repository", async () => {
    const result = await service.createWorkflow({
      tenantId: "t1",
      name: "My workflow",
      application: "orders",
      actions,
    });
    expect(result.name).toBe("My workflow");
    expect(result.application).toBe("orders");
    expect(mockDefinitions.createDefinition).toHaveBeenCalled();
  });

  it("listWorkflows returns mapped definitions", async () => {
    const rows = await service.listWorkflows("t1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("def-1");
  });

  // Regression: list/get must echo the persisted status. It was dropped by
  // toCreateResult, so disabled workflows rendered as enabled in the console
  // after a reload even though executions were still blocked.
  it("listWorkflows includes the persisted status", async () => {
    mockDefinitions.findDefinitionsByTenant.mockResolvedValueOnce([
      { ...baseRow, status: WorkflowStatus.DISABLED },
    ]);
    const rows = await service.listWorkflows("t1");
    expect(rows[0]?.status).toBe(WorkflowStatus.DISABLED);
  });

  it("getWorkflow includes the persisted status", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      status: WorkflowStatus.DISABLED,
    });
    const row = await service.getWorkflow("def-1", "t1");
    expect(row.status).toBe(WorkflowStatus.DISABLED);
  });

  it("getWorkflow throws when missing", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce(undefined);
    await expect(service.getWorkflow("missing", "t1")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("getWorkflow returns definition", async () => {
    const row = await service.getWorkflow("def-1", "t1");
    expect(row.id).toBe("def-1");
  });

  it("executeWorkflow starts Temporal and records execution", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
    });

    const result = await service.executeWorkflow("def-1", "t1", {
      orderId: "o1",
    });

    expect(result.runId).toBe("run-xyz");
    expect(mockTemporal.workflow.start).toHaveBeenCalled();
    expect(mockExecutions.createExecution).toHaveBeenCalled();

    const startCall = mockTemporal.workflow.start.mock.calls[0];
    const startArgs = startCall[1].args as unknown[];
    expect(startArgs).toHaveLength(3);
    expect(startArgs[1]).toBe(result.executionId);
  });

  it("executeWorkflow throws ConflictException with WORKFLOW_DISABLED code when workflow is disabled", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
      status: WorkflowStatus.DISABLED,
    });

    await expect(
      service.executeWorkflow("def-1", "t1", { orderId: "o1" })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockTemporal.workflow.start).not.toHaveBeenCalled();
  });

  it("executeWorkflow ConflictException body carries code, workflowId, and tenantId", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
      status: WorkflowStatus.DISABLED,
    });

    try {
      await service.executeWorkflow("def-1", "t1", { orderId: "o1" });
      throw new Error("expected executeWorkflow to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as {
        code: string;
        workflowId: string;
        tenantId: string;
      };
      expect(body.code).toBe("WORKFLOW_DISABLED");
      expect(body.workflowId).toBe("def-1");
      expect(body.tenantId).toBe("t1");
    }
  });

  it("executeWorkflow proceeds when the workflow is explicitly enabled", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
      status: WorkflowStatus.ENABLED,
    });

    const result = await service.executeWorkflow("def-1", "t1", {
      orderId: "o1",
    });

    expect(result.runId).toBe("run-xyz");
    expect(mockTemporal.workflow.start).toHaveBeenCalled();
  });

  it("executeWorkflow (K2) resolves without awaiting workflow completion", async () => {
    // Simulates the real Temporal contract: `client.workflow.start()` resolves
    // once the workflow is scheduled, independent of when it finishes running.
    // A never-resolving `handle.result()` here stands in for a slow/long-running
    // activity — if the controller/service ever switched to awaiting
    // completion (e.g. via `handle.result()` or `workflow.execute()`),
    // this test would hang and fail on the outer timeout.
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
    });

    let resultCalled = false;
    const neverResolvingResult = new Promise(() => {
      /* intentionally never resolves — stands in for a slow activity */
    });
    mockTemporal.workflow.start.mockImplementationOnce(() =>
      Promise.resolve({
        firstExecutionRunId: "run-slow",
        result: () => {
          resultCalled = true;
          return neverResolvingResult;
        },
      })
    );

    const settleMarker = Symbol("settled");
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve(settleMarker), 200)
    );

    const outcome = await Promise.race([
      service.executeWorkflow("def-1", "t1", { orderId: "o1" }),
      timeout,
    ]);

    expect(outcome).not.toBe(settleMarker);
    expect((outcome as { runId: string }).runId).toBe("run-slow");
    expect(resultCalled).toBe(false);
  });

  it("executeWorkflow forwards causal context into the WorkflowDefinition", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
    });

    const causal = {
      causation_id: "evt-root",
      correlation_id: "conv-1",
      depth: 0,
    };

    await service.executeWorkflow("def-1", "t1", { orderId: "o1" }, { causal });

    const startCall = mockTemporal.workflow.start.mock.calls[0];
    const startArgs = startCall[1].args as unknown[];
    const workflowDef = startArgs[0] as { causal?: typeof causal };
    expect(workflowDef.causal).toEqual(causal);
  });

  it("executeWorkflow omits causal when option is not provided", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
    });

    await service.executeWorkflow("def-1", "t1", { orderId: "o1" });

    const startCall = mockTemporal.workflow.start.mock.calls[0];
    const startArgs = startCall[1].args as unknown[];
    const workflowDef = startArgs[0] as { causal?: unknown };
    expect(workflowDef.causal).toBeUndefined();
  });

  it("deleteWorkflow soft-deletes via repository", async () => {
    await service.deleteWorkflow("def-1", "t1");
    expect(mockDefinitions.softDeleteDefinition).toHaveBeenCalledWith(
      "def-1",
      "t1"
    );
  });

  it("deleteWorkflow throws when nothing deleted", async () => {
    mockDefinitions.softDeleteDefinition.mockResolvedValueOnce(false);
    await expect(service.deleteWorkflow("x", "t1")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("listExecutions returns paginated rows + total when definition exists", async () => {
    const page = await service.listExecutions("def-1", "t1", {
      page: 1,
      pageSize: 20,
      sort: "desc",
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe("ex-1");
    expect(page.items[0]?.definitionId).toBe("def-1");
    expect(page.items[0]?.temporalWorkflowId).toBe("tw-1");
    expect(page.total).toBe(1);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
  });

  it("listExecutions forwards limit/offset/sort to the repository", async () => {
    await service.listExecutions("def-1", "t1", {
      page: 3,
      pageSize: 10,
      sort: "asc",
    });
    const call = mockExecutions.findExecutionsByDefinition.mock.calls[0];
    expect(call[0]).toEqual({
      definitionId: "def-1",
      tenantId: "t1",
      limit: 10,
      offset: 20,
      sort: "asc",
    });
  });

  it("listExecutions throws when definition missing", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce(undefined);
    await expect(
      service.listExecutions("missing", "t1", {
        page: 1,
        pageSize: 20,
        sort: "desc",
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getExecutionCountsByTenant folds rows into a record", async () => {
    mockExecutions.countExecutionsGroupedByDefinition.mockResolvedValueOnce([
      { definition_id: "def-1", count: 3 },
      { definition_id: "def-2", count: 7 },
    ]);
    const counts = await service.getExecutionCountsByTenant("t1");
    expect(counts).toEqual({ "def-1": 3, "def-2": 7 });
  });

  it("getExecutionCountsByTenant returns empty object when no executions", async () => {
    mockExecutions.countExecutionsGroupedByDefinition.mockResolvedValueOnce([]);
    const counts = await service.getExecutionCountsByTenant("t1");
    expect(counts).toEqual({});
  });

  it("getExecutionStatus describes Temporal handle and returns status", async () => {
    const out = await service.getExecutionStatus("def-1", "ex-1", "t1");
    expect(out.executionId).toBe("ex-1");
    expect(out.status).toBe("COMPLETED");
    expect(mockTemporal.workflow.getHandle).toHaveBeenCalledWith("tw-1");
  });

  it("getExecutionStatus throws when execution missing", async () => {
    mockExecutions.findExecutionById.mockResolvedValueOnce(undefined);
    await expect(
      service.getExecutionStatus("def-1", "missing", "t1")
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getExecutionStatus throws when definition id does not match execution", async () => {
    await expect(
      service.getExecutionStatus("wrong-def", "ex-1", "t1")
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Fix 1 (retention-expired runs): Temporal's handle.describe() throws
  // WorkflowNotFoundError once a run has aged out of retention — mapped to
  // GoneException/RUN_HISTORY_EXPIRED instead of surfacing as a raw 500.
  it("getExecutionStatus maps a Temporal WorkflowNotFoundError from describe() to a 410 RUN_HISTORY_EXPIRED GoneException", async () => {
    const mockHandle = {
      describe: mock(() =>
        Promise.reject(
          new TemporalWorkflowNotFoundError(
            "workflow not found for ID: acme:crm-support-telegram:sha256:abc",
            "tw-1",
            undefined
          )
        )
      ),
      result: mock(() => Promise.resolve({ ok: true })),
      terminate: mock(() => Promise.resolve()),
    };
    mockTemporal.workflow.getHandle.mockReturnValueOnce(mockHandle);

    let caught: unknown;
    try {
      await service.getExecutionStatus("def-1", "ex-1", "t1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GoneException);
    const response = (caught as GoneException).getResponse() as Record<
      string,
      unknown
    >;
    expect(response.statusCode).toBe(410);
    expect(response.code).toBe("RUN_HISTORY_EXPIRED");
    expect(response.executionId).toBe("ex-1");
    expect(response.temporalWorkflowId).toBe("tw-1");
  });

  it("getExecutionStatus maps a Temporal WorkflowNotFoundError from result() to a 410 RUN_HISTORY_EXPIRED GoneException", async () => {
    const mockHandle = {
      describe: mock(() => Promise.resolve({ status: { name: "COMPLETED" } })),
      result: mock(() =>
        Promise.reject(
          new TemporalWorkflowNotFoundError(
            "workflow not found for ID: acme:crm-support-telegram:sha256:abc",
            "tw-1",
            undefined
          )
        )
      ),
      terminate: mock(() => Promise.resolve()),
    };
    mockTemporal.workflow.getHandle.mockReturnValueOnce(mockHandle);

    await expect(
      service.getExecutionStatus("def-1", "ex-1", "t1")
    ).rejects.toBeInstanceOf(GoneException);
  });

  it("getExecutionStatus rethrows non-WorkflowNotFoundError describe() failures unchanged", async () => {
    const mockHandle = {
      describe: mock(() => Promise.reject(new Error("boom"))),
      result: mock(() => Promise.resolve({ ok: true })),
      terminate: mock(() => Promise.resolve()),
    };
    mockTemporal.workflow.getHandle.mockReturnValueOnce(mockHandle);

    await expect(
      service.getExecutionStatus("def-1", "ex-1", "t1")
    ).rejects.toThrow("boom");
  });

  // T07 of manual-loops/admin-console/console-redesign-builder-v2.md — first
  // hop of the per-node stats join ("T06 findings" in that SPEC).
  describe("listCorrelationIdsForDefinition", () => {
    it("resolves correlation ids from the repository with a 7d window and the bounded limit", async () => {
      const result = await service.listCorrelationIdsForDefinition(
        "def-1",
        "t1"
      );
      expect(result.correlationIds).toEqual(["corr-1", "corr-2"]);
      expect(
        mockExecutions.findCorrelationIdsByDefinition
      ).toHaveBeenCalledWith("def-1", "t1", expect.any(Date), 500);
    });

    it("returns an empty correlationIds array for a definition with no runs (legitimate empty case)", async () => {
      mockExecutions.findCorrelationIdsByDefinition.mockResolvedValueOnce([]);
      const result = await service.listCorrelationIdsForDefinition(
        "def-1",
        "t1"
      );
      expect(result.correlationIds).toEqual([]);
    });
  });

  describe("terminateRunningExecutions", () => {
    it("reads all ownership pages before terminating and ignores unowned exact IDs", async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ownedRow(`t1:old-name:${i}`));
      mockExecutions.findExecutionsByDefinition
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce([ownedRow("t1:old-name:last"), ownedRow("t1:old-name:priority:abc", "def-2")]);
      mockTemporal.workflow.list.mockImplementationOnce(() => asyncIterableOf([
        { workflowId: "t1:old-name:0", runId: "current-a" },
        { workflowId: "t1:old-name:last", runId: "current-b" },
        { workflowId: "t1:old-name:priority:abc", runId: "other-definition" },
        { workflowId: "t2:old-name:0", runId: "other-tenant" },
        { workflowId: "t1:old-name:missing", runId: "not-persisted" },
      ]));
      expect(await service.terminateRunningExecutions("t1", "def-1")).toEqual({ terminated: 2, failed: [] });
      expect(mockExecutions.findExecutionsByDefinition.mock.calls).toEqual([
        [{ tenantId: "t1", definitionId: "def-1", limit: 100, offset: 0, sort: "asc" }],
        [{ tenantId: "t1", definitionId: "def-1", limit: 100, offset: 100, sort: "asc" }],
      ]);
      expect(mockTemporal.workflow.getHandle.mock.calls).toEqual([
        ["t1:old-name:0", "current-a"], ["t1:old-name:last", "current-b"],
      ]);
    });

    it("does not terminate anything if a later ownership page fails", async () => {
      mockExecutions.findExecutionsByDefinition
        .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ownedRow(`t1:My workflow:${i}`)))
        .mockRejectedValueOnce(new Error("repository unavailable"));
      await expect(service.terminateRunningExecutions("t1", "def-1")).rejects.toThrow("repository unavailable");
      expect(mockTemporal.workflow.list).not.toHaveBeenCalled();
      expect(mockTemporal.workflow.getHandle).not.toHaveBeenCalled();
    });

    it("never falls back to a matching name when ownership is empty", async () => {
      mockExecutions.findExecutionsByDefinition.mockResolvedValueOnce([]);
      mockTemporal.workflow.list.mockImplementationOnce(() => asyncIterableOf([
        { workflowId: "t1:My workflow:abc", runId: "run-a" },
      ]));
      expect(await service.terminateRunningExecutions("t1", "def-1")).toEqual({ terminated: 0, failed: [] });
      expect(mockTemporal.workflow.getHandle).not.toHaveBeenCalled();
    });
    beforeEach(() => {
      mockExecutions.findExecutionsByDefinition.mockResolvedValue(["abc", "def", "ghi"].map(id => ownedRow(`t1:My workflow:${id}`)));
    });
    it("queries Temporal with the TenantId + Running visibility filter", async () => {
      await service.terminateRunningExecutions("t1", "def-1");

      expect(mockTemporal.workflow.list).toHaveBeenCalledWith({
        query: "TenantId='t1' AND ExecutionStatus='Running'",
      });
    });

    it("terminates only exact IDs owned by the tenant and definition", async () => {
      mockTemporal.workflow.list.mockImplementationOnce(() =>
        asyncIterableOf([
          { workflowId: "t1:My workflow:abc", runId: "run-a" },
          { workflowId: "t1:Other workflow:def", runId: "run-b" },
          { workflowId: "t2:My workflow:ghi", runId: "run-c" },
        ])
      );

      const result = await service.terminateRunningExecutions(
        "t1",
        "def-1"
      );

      expect(result).toEqual({ terminated: 1, failed: [] });
      expect(mockTemporal.workflow.getHandle).toHaveBeenCalledTimes(1);
      expect(mockTemporal.workflow.getHandle).toHaveBeenCalledWith(
        "t1:My workflow:abc",
        "run-a"
      );
    });

    it("terminates every matching handle with the disabled reason", async () => {
      mockTemporal.workflow.list.mockImplementationOnce(() =>
        asyncIterableOf([
          { workflowId: "t1:My workflow:abc", runId: "run-a" },
          { workflowId: "t1:My workflow:def", runId: "run-b" },
        ])
      );

      const terminateMock = mock(() => Promise.resolve());
      mockTemporal.workflow.getHandle.mockImplementation(() => ({
        terminate: terminateMock,
      }));

      const result = await service.terminateRunningExecutions(
        "t1",
        "def-1"
      );

      expect(result.terminated).toBe(2);
      expect(result.failed).toEqual([]);
      expect(terminateMock).toHaveBeenCalledTimes(2);
      expect(terminateMock).toHaveBeenCalledWith(
        "workflow disabled by tenant admin"
      );
    });

    it("collects failures without stopping the rest of the sweep", async () => {
      mockTemporal.workflow.list.mockImplementationOnce(() =>
        asyncIterableOf([
          { workflowId: "t1:My workflow:abc", runId: "run-a" },
          { workflowId: "t1:My workflow:def", runId: "run-b" },
          { workflowId: "t1:My workflow:ghi", runId: "run-c" },
        ])
      );

      let call = 0;
      mockTemporal.workflow.getHandle.mockImplementation(() => {
        call++;
        if (call === 2) {
          return {
            terminate: mock(() => Promise.reject(new Error("temporal down"))),
          };
        }
        return { terminate: mock(() => Promise.resolve()) };
      });

      const result = await service.terminateRunningExecutions(
        "t1",
        "def-1"
      );

      expect(result.terminated).toBe(2);
      expect(result.failed).toEqual([
        {
          workflowId: "t1:My workflow:def",
          runId: "run-b",
          error: "temporal down",
        },
      ]);
    });

    it("is a clean no-op when there are zero running executions", async () => {
      mockTemporal.workflow.list.mockImplementationOnce(() =>
        asyncIterableOf([])
      );

      const result = await service.terminateRunningExecutions(
        "t1",
        "def-1"
      );

      expect(result).toEqual({ terminated: 0, failed: [] });
      expect(mockTemporal.workflow.getHandle).not.toHaveBeenCalled();
    });
  });

  describe("updateWorkflowStatus", () => {
    it("uses stable definition ownership after a rename", async () => {
      mockDefinitions.setStatus.mockResolvedValueOnce({ ...baseRow, name: "Renamed", status: WorkflowStatus.DISABLED });
      mockTemporal.workflow.list.mockImplementationOnce(() => asyncIterableOf([
        { workflowId: "t1:My workflow:abc", runId: "run-before-rename" },
      ]));
      const result = await service.updateWorkflowStatus("t1", "def-1", WorkflowStatus.DISABLED);
      expect(result.terminated).toBe(1);
      expect(result.name).toBe("Renamed");
      expect(mockExecutions.findExecutionsByDefinition).toHaveBeenCalledWith({
        tenantId: "t1", definitionId: "def-1", limit: 100, offset: 0, sort: "asc",
      });
      expect(mockTemporal.workflow.getHandle).toHaveBeenCalledWith("t1:My workflow:abc", "run-before-rename");
    });
    beforeEach(() => {
      mockExecutions.findExecutionsByDefinition.mockResolvedValue(["abc", "def"].map(id => ownedRow(`t1:My workflow:${id}`)));
    });
    it("disabling sets status then terminates running executions and returns the count", async () => {
      mockDefinitions.setStatus.mockImplementationOnce(() =>
        Promise.resolve({ ...baseRow, status: WorkflowStatus.DISABLED })
      );
      mockTemporal.workflow.list.mockImplementationOnce(() =>
        asyncIterableOf([
          { workflowId: "t1:My workflow:abc", runId: "run-a" },
          { workflowId: "t1:My workflow:def", runId: "run-b" },
        ])
      );

      const result = await service.updateWorkflowStatus(
        "t1",
        "def-1",
        WorkflowStatus.DISABLED
      );

      expect(mockDefinitions.setStatus).toHaveBeenCalledWith(
        "t1",
        "def-1",
        WorkflowStatus.DISABLED
      );
      expect(mockTemporal.workflow.list).toHaveBeenCalledWith({
        query: "TenantId='t1' AND ExecutionStatus='Running'",
      });
      expect(result).toEqual({
        id: "def-1",
        name: "My workflow",
        status: WorkflowStatus.DISABLED,
        terminated: 2,
      });
    });

    it("enabling sets status without touching Temporal executions", async () => {
      mockDefinitions.setStatus.mockImplementationOnce(() =>
        Promise.resolve({ ...baseRow, status: WorkflowStatus.ENABLED })
      );

      const result = await service.updateWorkflowStatus(
        "t1",
        "def-1",
        WorkflowStatus.ENABLED
      );

      expect(mockDefinitions.setStatus).toHaveBeenCalledWith(
        "t1",
        "def-1",
        WorkflowStatus.ENABLED
      );
      expect(mockTemporal.workflow.list).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "def-1",
        name: "My workflow",
        status: WorkflowStatus.ENABLED,
      });
    });

    it("is idempotent when disabling an already-disabled workflow", async () => {
      mockDefinitions.setStatus.mockImplementationOnce(() =>
        Promise.resolve({ ...baseRow, status: WorkflowStatus.DISABLED })
      );
      mockTemporal.workflow.list.mockImplementationOnce(() =>
        asyncIterableOf([])
      );

      const result = await service.updateWorkflowStatus(
        "t1",
        "def-1",
        WorkflowStatus.DISABLED
      );

      expect(result).toEqual({
        id: "def-1",
        name: "My workflow",
        status: WorkflowStatus.DISABLED,
        terminated: 0,
      });
    });

    it("is idempotent when enabling an already-enabled workflow", async () => {
      mockDefinitions.setStatus.mockImplementationOnce(() =>
        Promise.resolve({ ...baseRow, status: WorkflowStatus.ENABLED })
      );

      const result = await service.updateWorkflowStatus(
        "t1",
        "def-1",
        WorkflowStatus.ENABLED
      );

      expect(result).toEqual({
        id: "def-1",
        name: "My workflow",
        status: WorkflowStatus.ENABLED,
      });
      expect(mockTemporal.workflow.list).not.toHaveBeenCalled();
    });

    it("maps WorkflowNotFoundError to NotFoundException", async () => {
      mockDefinitions.setStatus.mockImplementationOnce(() =>
        Promise.reject(new WorkflowNotFoundError("missing", "t1"))
      );

      await expect(
        service.updateWorkflowStatus("t1", "missing", WorkflowStatus.DISABLED)
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
