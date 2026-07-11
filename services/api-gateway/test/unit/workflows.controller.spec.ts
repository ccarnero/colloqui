import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { WorkflowProxyService } from "../../src/modules/workflows/workflow-proxy.service";
import { WorkflowsController } from "../../src/modules/workflows/workflows.controller";
import type {
  CreateWorkflowGatewayDto,
  ExecuteWorkflowGatewayDto,
  UpdateWorkflowGatewayDto,
  UpdateWorkflowStatusGatewayDto,
} from "../../src/modules/workflows/workflows-gateway.dto";
import type { ITenantScopedRequest } from "../../src/types/yoizen-request";

describe("WorkflowsController", () => {
  let controller: WorkflowsController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ ok: true }));

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [{ provide: WorkflowProxyService, useValue: { proxy } }],
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
    const localReq = { ...req, body } as ITenantScopedRequest;
    await controller.createWorkflow(localReq);
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
    const localReq = { ...req, body } as ITenantScopedRequest;
    await controller.updateWorkflow(localReq, "wf-1");
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
    const query = { page: "1", pageSize: "20", sort: "desc" };
    await controller.listExecutions(req, "wf-1", query);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/wf-1/executions",
      tenantId: "tenant-x",
      query,
    });
    await controller.getExecutionStatus(req, "wf-1", "ex-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/wf-1/executions/ex-1",
      tenantId: "tenant-x",
    });
  });

  it("getExecutionCounts delegates to /workflows/executions/counts", async () => {
    await controller.getExecutionCounts(req);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/executions/counts",
      tenantId: "tenant-x",
    });
  });

  it("getSummary delegates to /workflows/summary", async () => {
    await controller.getSummary(req);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/workflows/summary",
      tenantId: "tenant-x",
    });
  });

  it("updateWorkflowStatus delegates to PATCH /workflows/:id/status", async () => {
    const body = { status: "disabled" } as UpdateWorkflowStatusGatewayDto;
    await controller.updateWorkflowStatus(req, "wf-1", body);
    expect(proxy).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/workflows/wf-1/status",
      tenantId: "tenant-x",
      body: body as unknown as Record<string, unknown>,
    });
  });
});
