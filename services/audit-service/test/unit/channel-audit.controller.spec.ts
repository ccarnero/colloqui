import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { ChannelAuditController } from "../../src/modules/channel-audit/channel-audit.controller";
import { ChannelAuditService } from "../../src/modules/channel-audit/channel-audit.service";

const tenantGuardAllow = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.tenantId = "test-tenant";
    return true;
  },
};

describe("ChannelAuditController", () => {
  let controller: ChannelAuditController;
  let getEventById: ReturnType<typeof mock>;

  beforeEach(async () => {
    getEventById = mock(() => Promise.resolve(null));
    const mockSvc = {
      queryEvents: mock(() => Promise.resolve([])),
      getEventById,
    };
    const module = await Test.createTestingModule({
      controllers: [ChannelAuditController],
      providers: [{ provide: ChannelAuditService, useValue: mockSvc }],
    })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuardAllow)
      .compile();

    controller = module.get(ChannelAuditController);
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
      Promise.resolve({ id: "ce1" } as never),
    );
    const ev = await controller.getEvent("t1", "ce1");
    expect((ev as { id: string }).id).toBe("ce1");
  });

  it("getEvent throws when missing", async () => {
    await expect(controller.getEvent("t1", "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
