import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import type { WorkflowAction } from "@yoizen/shared";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service";
import { WorkflowsRepository } from "../../src/modules/workflows/workflows.repository";
import { TEMPORAL_CLIENT } from "../../src/providers/temporal.provider";
import type { WorkflowDefinitionRow } from "../../src/modules/workflows/workflows.repository";

describe("WorkflowsService", () => {
  const actions: WorkflowAction[] = [
    { activity: "jsFunction", name: "n1", args: { code: "return 1" } },
  ];

  const baseRow: WorkflowDefinitionRow = {
    id: "def-1",
    tenant_id: "t1",
    name: "My workflow",
    application: "orders",
    actions,
    created_at: new Date("2024-06-01T00:00:00.000Z"),
    updated_at: new Date("2024-06-01T00:00:00.000Z"),
    deleted_at: null,
  };

  let service: WorkflowsService;
  let mockTemporal: {
    workflow: { start: ReturnType<typeof mock> };
  };
  let mockRepo: {
    createDefinition: ReturnType<typeof mock>;
    findDefinitionById: ReturnType<typeof mock>;
    findDefinitionsByTenant: ReturnType<typeof mock>;
    createExecution: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    mockTemporal = {
      workflow: {
        start: mock(() =>
          Promise.resolve({ firstExecutionRunId: "run-xyz" }),
        ),
      },
    };

    mockRepo = {
      createDefinition: mock(
        (
          id: string,
          tenantId: string,
          name: string,
          application: string,
          acts: unknown[],
        ) =>
          Promise.resolve({
            ...baseRow,
            id,
            tenant_id: tenantId,
            name,
            application,
            actions: acts,
          }),
      ),
      findDefinitionById: mock(() => Promise.resolve(baseRow)),
      findDefinitionsByTenant: mock(() => Promise.resolve([baseRow])),
      createExecution: mock(
        (
          id: string,
          definitionId: string,
          tenantId: string,
          temporalWorkflowId: string,
          temporalRunId: string,
          request: Record<string, unknown>,
        ) =>
          Promise.resolve({
            id,
            definition_id: definitionId,
            tenant_id: tenantId,
            temporal_workflow_id: temporalWorkflowId,
            temporal_run_id: temporalRunId,
            request,
            status: "RUNNING",
            created_at: new Date(),
            updated_at: new Date(),
          }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: TEMPORAL_CLIENT, useValue: mockTemporal },
        { provide: WorkflowsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = moduleRef.get(WorkflowsService);
  });

  it("createWorkflow persists via repository", async () => {
    const result = await service.createWorkflow(
      "t1",
      "My workflow",
      "orders",
      actions,
    );
    expect(result.name).toBe("My workflow");
    expect(result.application).toBe("orders");
    expect(mockRepo.createDefinition).toHaveBeenCalled();
  });

  it("listWorkflows returns mapped definitions", async () => {
    const rows = await service.listWorkflows("t1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("def-1");
  });

  it("getWorkflow throws when missing", async () => {
    mockRepo.findDefinitionById.mockResolvedValueOnce(undefined);
    await expect(service.getWorkflow("missing", "t1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("getWorkflow returns definition", async () => {
    const row = await service.getWorkflow("def-1", "t1");
    expect(row.id).toBe("def-1");
  });

  it("executeWorkflow starts Temporal and records execution", async () => {
    mockRepo.findDefinitionById.mockResolvedValueOnce({
      ...baseRow,
      actions,
    });

    const result = await service.executeWorkflow("def-1", "t1", {
      orderId: "o1",
    });

    expect(result.runId).toBe("run-xyz");
    expect(mockTemporal.workflow.start).toHaveBeenCalled();
    expect(mockRepo.createExecution).toHaveBeenCalled();
  });
});
