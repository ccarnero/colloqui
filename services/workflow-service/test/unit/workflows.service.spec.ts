import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import type { WorkflowAction } from "@yoizen/shared";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service";
import {
  EXECUTIONS_REPOSITORY,
} from "../../src/modules/workflows/executions.repository.interface";
import {
  WORKFLOWS_REPOSITORY,
  type IWorkflowDefinitionRow,
} from "../../src/modules/workflows/workflows.repository.interface";

import { RegisteredServicesResolver } from "../../src/modules/workflows/registered-services.resolver";
import { TEMPORAL_CLIENT } from "../../src/providers/temporal.provider";

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
    created_at: new Date("2024-06-01T00:00:00.000Z"),
    updated_at: new Date("2024-06-01T00:00:00.000Z"),
    deleted_at: null,
  };

  let service: WorkflowsService;
  let mockTemporal: {
    workflow: { start: ReturnType<typeof mock> };
  };
  let mockDefinitions: {
    createDefinition: ReturnType<typeof mock>;
    findDefinitionById: ReturnType<typeof mock>;
    findDefinitionsByTenant: ReturnType<typeof mock>;
    softDeleteDefinition: ReturnType<typeof mock>;
  };
  let mockExecutions: {
    createExecution: ReturnType<typeof mock>;
    findExecutionsByDefinition: ReturnType<typeof mock>;
    countExecutionsByDefinition: ReturnType<typeof mock>;
    countExecutionsGroupedByDefinition: ReturnType<typeof mock>;
    findExecutionById: ReturnType<typeof mock>;
    updateExecutionStatus: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const mockHandle = {
      describe: mock(() =>
        Promise.resolve({ status: { name: "COMPLETED" } }),
      ),
      result: mock(() => Promise.resolve({ ok: true })),
    };
    mockTemporal = {
      workflow: {
        start: mock(() => Promise.resolve({ firstExecutionRunId: "run-xyz" })),
        getHandle: mock(() => mockHandle),
      },
    };

    mockDefinitions = {
      createDefinition: mock((params: {
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
        }),
      ),
      findDefinitionById: mock(() => Promise.resolve(baseRow)),
      findDefinitionsByTenant: mock(() => Promise.resolve([baseRow])),
      softDeleteDefinition: mock(() => Promise.resolve(true)),
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
          }),
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
        ]),
      ),
      countExecutionsByDefinition: mock(() => Promise.resolve(1)),
      countExecutionsGroupedByDefinition: mock(() =>
        Promise.resolve([{ definition_id: "def-1", count: 3 }]),
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
        }),
      ),
      updateExecutionStatus: mock(() => Promise.resolve()),
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

  it("getWorkflow throws when missing", async () => {
    mockDefinitions.findDefinitionById.mockResolvedValueOnce(undefined);
    await expect(service.getWorkflow("missing", "t1")).rejects.toBeInstanceOf(
      NotFoundException,
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
    expect(startArgs).toHaveLength(2);
    expect(startArgs[1]).toBe(result.executionId);
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

    await service.executeWorkflow(
      "def-1",
      "t1",
      { orderId: "o1" },
      { causal },
    );

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
      "t1",
    );
  });

  it("deleteWorkflow throws when nothing deleted", async () => {
    mockDefinitions.softDeleteDefinition.mockResolvedValueOnce(false);
    await expect(service.deleteWorkflow("x", "t1")).rejects.toBeInstanceOf(
      NotFoundException,
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
      }),
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
      service.getExecutionStatus("def-1", "missing", "t1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getExecutionStatus throws when definition id does not match execution", async () => {
    await expect(
      service.getExecutionStatus("wrong-def", "ex-1", "t1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
