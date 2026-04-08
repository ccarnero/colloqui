import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { WorkflowsController } from "../../src/modules/workflows/workflows.controller";
import { WorkflowProxyService } from "../../src/modules/workflows/workflow-proxy.service";
import type { ITenantScopedRequest } from "../../src/types/yoizen-request";
import type {
  CreateWorkflowGatewayDto,
  UpdateWorkflowGatewayDto,
  ExecuteWorkflowGatewayDto,
} from "../../src/modules/workflows/workflows-gateway.dto";

describe("WorkflowsController", () => {
  let controller: WorkflowsController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ ok: true }));

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [
        { provide: WorkflowProxyService, useValue: { proxy } },
      ],
    }).compile();

    controller = moduleRef.get(WorkflowsController);
  });

  const req = { tenantId: "tenant-x" } as ITenantScopedRequest;

  it("listWorkflows delegates to WorkflowProxyService", async () => {
    await controller.listWorkflows(req);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows",
      tenantId: "tenant-x",
    });
  });

  it("createWorkflow delegates", async () => {
    const body = {
      name: "w",
      application: "app",
      actions: [{ type: "noop" }],
    } as CreateWorkflowGatewayDto;
    await controller.createWorkflow(req, body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows",
      tenantId: "tenant-x",
      body: body as unknown as Record<string, unknown>,
    });
  });

  it("updateWorkflow delegates", async () => {
    const body = {
      name: "updated",
      application: "app",
      actions: [{ type: "noop" }],
    } as UpdateWorkflowGatewayDto;
    await controller.updateWorkflow(req, "wf-1", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "PUT",
      path: "/workflows/wf-1",
      tenantId: "tenant-x",
      body: body as unknown as Record<string, unknown>,
    });
  });

  it("getWorkflow and deleteWorkflow delegate", async () => {
    await controller.getWorkflow(req, "wf-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/wf-1",
      tenantId: "tenant-x",
    });
    await controller.deleteWorkflow(req, "wf-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/workflows/wf-1",
      tenantId: "tenant-x",
    });
  });

  it("executeWorkflow delegates", async () => {
    const body = { request: { x: 1 } } as ExecuteWorkflowGatewayDto;
    await controller.executeWorkflow(req, "wf-1", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/workflows/wf-1/execute",
      tenantId: "tenant-x",
      body: body as unknown as Record<string, unknown>,
    });
  });

  it("listExecutions and getExecutionStatus delegate", async () => {
    await controller.listExecutions(req, "wf-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/wf-1/executions",
      tenantId: "tenant-x",
    });
    await controller.getExecutionStatus(req, "wf-1", "ex-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/wf-1/executions/ex-1",
      tenantId: "tenant-x",
    });
  });
});
