import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdminAgentsController } from "../../src/modules/admin/admin-agents.controller";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("AdminAgentsController — revert + memory-proposals proxy routes", () => {
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

  const req = { tenantId: "t1", user: { sub: "user-1" } } as never;

  it("revertAgent proxies POST /admin/agents/:id/revert with trustedUserId", async () => {
    await controller.revertAgent(req, UUID);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: `/admin/agents/${UUID}/revert`,
      tenantId: "t1",
      trustedUserId: "user-1",
    });
  });

  it("listMemoryProposals proxies GET /admin/agents/memory-proposals", async () => {
    await controller.listMemoryProposals(req);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/agents/memory-proposals",
      tenantId: "t1",
    });
  });

  it("approveMemoryProposal proxies POST /admin/agents/memory-proposals/:id/approve", async () => {
    await controller.approveMemoryProposal(req, "proposal-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/admin/agents/memory-proposals/proposal-1/approve",
      tenantId: "t1",
      trustedUserId: "user-1",
    });
  });

  it("rejectMemoryProposal proxies POST /admin/agents/memory-proposals/:id/reject", async () => {
    await controller.rejectMemoryProposal(req, "proposal-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/admin/agents/memory-proposals/proposal-1/reject",
      tenantId: "t1",
      trustedUserId: "user-1",
    });
  });
});
