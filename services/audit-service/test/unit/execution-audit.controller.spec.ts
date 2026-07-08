import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { ExecutionAuditController } from "../../src/modules/execution-audit/execution-audit.controller";
import { ExecutionAuditService } from "../../src/modules/execution-audit/execution-audit.service";

const tenantGuardAllow = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.tenantId = "test-tenant";
    return true;
  },
};

describe("ExecutionAuditController", () => {
  let controller: ExecutionAuditController;
  let getEventById: ReturnType<typeof mock>;

  beforeEach(async () => {
    getEventById = mock(() => Promise.resolve(null));
    const mockSvc = {
      queryEvents: mock(() => Promise.resolve([])),
      getEventById,
    };
    const module = await Test.createTestingModule({
      controllers: [ExecutionAuditController],
      providers: [{ provide: ExecutionAuditService, useValue: mockSvc }],
    })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuardAllow)
      .compile();

    controller = module.get(ExecutionAuditController);
  });

  it("queryEvents returns paginated envelope", async () => {
    const r = await controller.queryEvents("t1", {
      limit: 10,
      offset: 0,
    } as never);
    expect(r.events).toEqual([]);
  });

  it("getEvent returns row when found", async () => {
    getEventById.mockImplementation(() =>
      Promise.resolve({ id: "exec-evt-1" } as never)
    );
    const ev = await controller.getEvent("t1", "exec-evt-1");
    expect((ev as { id: string }).id).toBe("exec-evt-1");
  });

  it("getEvent throws when missing", async () => {
    await expect(controller.getEvent("t1", "x")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
