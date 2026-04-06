import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdminAgentsController } from "../../src/modules/admin/admin-agents.controller";
import { AdminCredentialsController } from "../../src/modules/admin/admin-credentials.controller";
import { AdminJobsController } from "../../src/modules/admin/admin-jobs.controller";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("AdminAgentsController", () => {
  let controller: AdminAgentsController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({}));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAgentsController],
      providers: [{ provide: AdminProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(AdminAgentsController);
  });

  const req = { tenantId: "t1" } as never;

  it("listAgents forwards query params", async () => {
    await controller.listAgents(req, {
      status: "published",
      is_active: "true",
      limit: 20,
      offset: 5,
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/agents",
      tenantId: "t1",
      query: {
        status: "published",
        is_active: "true",
        limit: "20",
        offset: "5",
      },
    });
  });

  it("getAgent uses UUID path", async () => {
    await controller.getAgent(req, UUID);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: `/admin/agents/${UUID}`,
      tenantId: "t1",
    });
  });
});

describe("AdminCredentialsController", () => {
  let controller: AdminCredentialsController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({}));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminCredentialsController],
      providers: [{ provide: AdminProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(AdminCredentialsController);
  });

  const req = { tenantId: "t1" } as never;

  it("listCredentials forwards query params", async () => {
    await controller.listCredentials(req, {
      type: "api_key",
      is_active: "true",
      limit: 10,
      offset: 0,
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/credentials",
      tenantId: "t1",
      query: {
        type: "api_key",
        is_active: "true",
        limit: "10",
        offset: "0",
      },
    });
  });

  it("deleteCredential issues DELETE", async () => {
    await controller.deleteCredential(req, UUID);
    expect(proxy).toHaveBeenCalledWith({
      method: "DELETE",
      path: `/admin/credentials/${UUID}`,
      tenantId: "t1",
    });
  });
});

describe("AdminJobsController", () => {
  let controller: AdminJobsController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({}));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminJobsController],
      providers: [{ provide: AdminProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(AdminJobsController);
  });

  const req = { tenantId: "t1" } as never;

  it("listJobs forwards agent and pagination", async () => {
    await controller.listJobs(req, {
      agent_id: UUID,
      is_active: "false",
      limit: 5,
      offset: 10,
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/jobs",
      tenantId: "t1",
      query: {
        agent_id: UUID,
        is_active: "false",
        limit: "5",
        offset: "10",
      },
    });
  });

  it("listExecutions uses /admin/jobs/executions", async () => {
    await controller.listExecutions(req, {
      job_id: UUID,
      status: "running",
      limit: 15,
      offset: 0,
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/jobs/executions",
      tenantId: "t1",
      query: {
        job_id: UUID,
        status: "running",
        limit: "15",
        offset: "0",
      },
    });
  });
});
