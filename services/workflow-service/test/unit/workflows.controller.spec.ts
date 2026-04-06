import type { ExecutionContext } from "@nestjs/common";
import { describe, it, expect, beforeEach, mock } from "bun:test";
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

  beforeEach(async () => {
    getWorkflow = mock(() => Promise.resolve(null));
    createWorkflow = mock(() => Promise.resolve({ id: "wf" }));
    listWorkflows = mock(() => Promise.resolve([]));
    deleteWorkflow = mock(() => Promise.resolve());
    executeWorkflow = mock(() => Promise.resolve({ runId: "r1" }));
    listExecutions = mock(() => Promise.resolve([]));
    getExecutionStatus = mock(() => Promise.resolve({ status: "RUNNING" }));
    const workflowsService = {
      createWorkflow,
      listWorkflows,
      getWorkflow,
      deleteWorkflow,
      executeWorkflow,
      listExecutions,
      getExecutionStatus,
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
    await controller.executeWorkflow("t1", "wf-1", { request: { x: 1 } });
    expect(executeWorkflow).toHaveBeenCalledWith("wf-1", "t1", { x: 1 });
  });

  it("listExecutions delegates", async () => {
    await controller.listExecutions("t1", "wf-1");
    expect(listExecutions).toHaveBeenCalledWith("wf-1", "t1");
  });

  it("getExecutionStatus delegates", async () => {
    await controller.getExecutionStatus("t1", "wf-1", "ex-1");
    expect(getExecutionStatus).toHaveBeenCalledWith("wf-1", "ex-1", "t1");
  });
});
