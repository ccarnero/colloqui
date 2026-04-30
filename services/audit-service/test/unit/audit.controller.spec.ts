import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { AuditController } from "../../src/modules/audit/audit.controller";
import { AuditService } from "../../src/modules/audit/audit.service";

const tenantGuardAllow = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.tenantId = "test-tenant";
    return true;
  },
};

describe("AuditController", () => {
  let controller: AuditController;
  let queryEvents: ReturnType<typeof mock>;
  let getEventById: ReturnType<typeof mock>;

  beforeEach(async () => {
    queryEvents = mock(() => Promise.resolve([]));
    getEventById = mock(() => Promise.resolve(null));

    const auditService = {
      queryEvents,
      getEventById,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: auditService }],
    })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuardAllow)
      .compile();

    controller = moduleRef.get(AuditController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("queryEvents delegates to AuditService with clamped pagination", async () => {
    const r = await controller.queryEvents("t1", {
      limit: 10,
      offset: 0,
    } as import("../../src/modules/audit/audit.dto").QueryEventsDto);
    expect(r.events).toEqual([]);
    expect(r.limit).toBe(10);
    expect(r.offset).toBe(0);
    expect(queryEvents).toHaveBeenCalled();
  });

  it("getEvent returns event when found", async () => {
    getEventById.mockImplementation(() =>
      Promise.resolve({ id: "e1" } as never),
    );
    const ev = await controller.getEvent("t1", "e1");
    expect((ev as { id: string }).id).toBe("e1");
  });

  it("getEvent throws NotFoundException when missing", async () => {
    getEventById.mockImplementation(() => Promise.resolve(null));
    await expect(controller.getEvent("t1", "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
