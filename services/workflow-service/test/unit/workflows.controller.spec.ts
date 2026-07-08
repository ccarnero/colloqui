import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ExecutionContext } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { WorkflowsController } from "../../src/modules/workflows/workflows.controller";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service";

const tenantGuardAllow = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.tenantId = "test-tenant";
    return true;
  },
};

describe("WorkflowsController", () => {
  let controller: WorkflowsController;
  let getWorkflow: ReturnType<typeof mock>;
  let createWorkflow: ReturnType<typeof mock>;
  let listWorkflows: ReturnType<typeof mock>;
  let deleteWorkflow: ReturnType<typeof mock>;
  let executeWorkflow: ReturnType<typeof mock>;
  let listExecutions: ReturnType<typeof mock>;
  let getExecutionStatus: ReturnType<typeof mock>;
  let getExecutionCountsByTenant: ReturnType<typeof mock>;

  beforeEach(async () => {
    getWorkflow = mock(() => Promise.resolve(null));
    createWorkflow = mock(() => Promise.resolve({ id: "wf" }));
    listWorkflows = mock(() => Promise.resolve([]));
    deleteWorkflow = mock(() => Promise.resolve());
    executeWorkflow = mock(() => Promise.resolve({ runId: "r1" }));
    listExecutions = mock(() =>
      Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 })
    );
    getExecutionStatus = mock(() => Promise.resolve({ status: "RUNNING" }));
    getExecutionCountsByTenant = mock(() => Promise.resolve({}));
    const workflowsService = {
      createWorkflow,
      listWorkflows,
      getWorkflow,
      deleteWorkflow,
      executeWorkflow,
      listExecutions,
      getExecutionStatus,
      getExecutionCountsByTenant,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [{ provide: WorkflowsService, useValue: workflowsService }],
    })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuardAllow)
      .compile();

    controller = moduleRef.get(WorkflowsController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("getWorkflow delegates to WorkflowsService.getWorkflow", async () => {
    await controller.getWorkflow("test-tenant", "wf-1");
    expect(getWorkflow).toHaveBeenCalledWith("wf-1", "test-tenant");
  });

  it("createWorkflow delegates with actions", async () => {
    await controller.createWorkflow("t1", {
      name: "n",
      application: "app",
      actions: [{ activity: "jsFunction", name: "a", args: {} }],
    } as import("../../src/modules/workflows/dto/create-workflow.dto").CreateWorkflowDto);
    expect(createWorkflow).toHaveBeenCalled();
  });

  it("listWorkflows delegates", async () => {
    await controller.listWorkflows("t1");
    expect(listWorkflows).toHaveBeenCalledWith("t1");
  });

  it("deleteWorkflow delegates", async () => {
    await controller.deleteWorkflow("t1", "wf-1");
    expect(deleteWorkflow).toHaveBeenCalledWith("wf-1", "t1");
  });

  it("executeWorkflow delegates", async () => {
    const fakeReq = {
      headers: {},
    } as unknown as import("fastify").FastifyRequest;
    await controller.executeWorkflow(
      "t1",
      "wf-1",
      { request: { x: 1 } },
      fakeReq
    );
    expect(executeWorkflow).toHaveBeenCalledWith(
      "wf-1",
      "t1",
      { x: 1 },
      {
        requestId: null,
        agentTimeoutMs: undefined,
      }
    );
  });

  it("listExecutions delegates with parsed query (defaults)", async () => {
    await controller.listExecutions("t1", "wf-1", {});
    expect(listExecutions).toHaveBeenCalledWith("wf-1", "t1", {
      page: 1,
      pageSize: 20,
      sort: "desc",
    });
  });

  it("listExecutions parses page, pageSize and sort from query", async () => {
    await controller.listExecutions("t1", "wf-1", {
      page: "3",
      pageSize: "10",
      sort: "asc",
    });
    expect(listExecutions).toHaveBeenCalledWith("wf-1", "t1", {
      page: 3,
      pageSize: 10,
      sort: "asc",
    });
  });

  it("listExecutions clamps invalid query values to defaults", async () => {
    await controller.listExecutions("t1", "wf-1", {
      page: "-2",
      pageSize: "999",
      sort: "weird",
    });
    expect(listExecutions).toHaveBeenCalledWith("wf-1", "t1", {
      page: 1,
      pageSize: 100,
      sort: "desc",
    });
  });

  it("getExecutionStatus delegates", async () => {
    await controller.getExecutionStatus("t1", "wf-1", "ex-1");
    expect(getExecutionStatus).toHaveBeenCalledWith("wf-1", "ex-1", "t1");
  });

  it("getExecutionCounts delegates to service", async () => {
    await controller.getExecutionCounts("t1");
    expect(getExecutionCountsByTenant).toHaveBeenCalledWith("t1");
  });
});
