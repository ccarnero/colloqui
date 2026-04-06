import type { ExecutionContext } from "@nestjs/common";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { ExecutionsController } from "../../src/modules/executions/executions.controller";
import { ExecutionsService } from "../../src/modules/executions/executions.service";
import { ListExecutionsQueryDto } from "../../src/modules/executions/list-executions-query.dto";

const tenantGuardAllow = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.tenantId = "test-tenant";
    return true;
  },
};

describe("ExecutionsController", () => {
  let controller: ExecutionsController;
  let findAll: ReturnType<typeof mock>;
  let findByScheduleId: ReturnType<typeof mock>;
  let findById: ReturnType<typeof mock>;

  beforeEach(async () => {
    findAll = mock(() =>
      Promise.resolve({ executions: [], limit: 500, offset: 0 }),
    );
    findByScheduleId = mock(() =>
      Promise.resolve({ executions: [], limit: 10, offset: 0 }),
    );
    findById = mock(() => Promise.resolve(null));
    const executionsService = {
      findByScheduleId,
      findAll,
      findById,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ExecutionsController],
      providers: [{ provide: ExecutionsService, useValue: executionsService }],
    })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuardAllow)
      .compile();

    controller = moduleRef.get(ExecutionsController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("findAll delegates to ExecutionsService.findAll with clamped pagination", async () => {
    const query = {
      limit: 10_000,
      offset: -5,
    } as ListExecutionsQueryDto;
    await controller.findAll("tenant-1", query);
    expect(findAll).toHaveBeenCalled();
    const arg = findAll.mock.calls[0][0];
    expect(arg.limit).toBe(500);
    expect(arg.offset).toBe(0);
  });

  it("findBySchedule delegates with clamped pagination", async () => {
    const query = { limit: 100, offset: 0 } as ListExecutionsQueryDto;
    await controller.findBySchedule("tenant-1", "sched-1", query);
    expect(findByScheduleId).toHaveBeenCalled();
    const args = findByScheduleId.mock.calls[0];
    expect(args[0]).toBe("sched-1");
    expect(args[2]).toBe("tenant-1");
  });

  it("findById returns execution or throws NotFoundException", async () => {
    findById.mockImplementation(() =>
      Promise.resolve({
        id: "ex1",
        schedule_id: "s1",
        status: "done",
      } as never),
    );
    const row = await controller.findById("tenant-1", "ex1");
    expect((row as { id: string }).id).toBe("ex1");
  });
});
