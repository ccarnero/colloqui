import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { AuditController } from "../../src/modules/audit/audit.controller";
import { AuditService } from "../../src/modules/audit/audit.service";
import type { ChainTreeResult } from "../../src/modules/audit/build-chain-tree";

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
  let getChain: ReturnType<typeof mock>;

  beforeEach(async () => {
    queryEvents = mock(() => Promise.resolve([]));
    getEventById = mock(() => Promise.resolve(null));
    getChain = mock(() => Promise.resolve(null));

    const auditService = {
      queryEvents,
      getEventById,
      getChain,
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

  it("queryEvents forwards correlation_id filter to service", async () => {
    await controller.queryEvents("t1", {
      limit: 10,
      offset: 0,
      correlation_id: "corr-abc",
    } as import("../../src/modules/audit/audit.dto").QueryEventsDto);
    expect(queryEvents).toHaveBeenCalled();
    const callArgs = queryEvents.mock.calls[0]?.[0] as { correlation_id?: string };
    expect(callArgs?.correlation_id).toBe("corr-abc");
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

  it("getChain returns assembled tree when correlation_id matches", async () => {
    const fakeChain: ChainTreeResult = {
      correlation_id: "corr-1",
      root: {
        id: "root",
        type: "t",
        subject: "s",
        causation_id: null,
        depth: 0,
        created_at: new Date().toISOString(),
        children: [],
      },
      node_count: 1,
      max_depth: 0,
      truncated: false,
      synthetic_root: false,
      orphans: [],
      extra_roots: [],
    };
    getChain.mockImplementation(() => Promise.resolve(fakeChain));

    const result = await controller.getChain("t1", "corr-1");
    expect((result as ChainTreeResult).correlation_id).toBe("corr-1");
    expect(getChain).toHaveBeenCalledWith("corr-1", "t1");
  });

  it("getChain throws NotFoundException when correlation_id not found", async () => {
    getChain.mockImplementation(() => Promise.resolve(null));
    await expect(controller.getChain("t1", "unknown")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("chain route does not collide with event-by-id route", async () => {
    // Both routes should be callable independently
    getChain.mockImplementation(() =>
      Promise.resolve({
        correlation_id: "chain-id",
        root: { id: "r", type: "t", subject: "s", causation_id: null, depth: 0, created_at: "", children: [] },
        node_count: 1, max_depth: 0, truncated: false, synthetic_root: false, orphans: [], extra_roots: [],
      } satisfies ChainTreeResult),
    );
    getEventById.mockImplementation(() => Promise.resolve({ id: "event-id" } as never));

    const chain = await controller.getChain("t1", "chain-id");
    const event = await controller.getEvent("t1", "event-id");

    expect((chain as ChainTreeResult).correlation_id).toBe("chain-id");
    expect((event as { id: string }).id).toBe("event-id");
  });
});
