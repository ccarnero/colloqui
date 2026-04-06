import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { SchedulersController } from "../../src/modules/schedulers/schedulers.controller";
import { SchedulerProxyService } from "../../src/modules/schedulers/schedulers.service";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";

describe("SchedulersController", () => {
  let controller: SchedulersController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ schedules: [] }));
    const moduleRef = await Test.createTestingModule({
      controllers: [SchedulersController],
      providers: [{ provide: SchedulerProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(SchedulersController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("listSchedules delegates with query", async () => {
    await controller.listSchedules(req as never, {
      enabled: true,
      type: undefined,
      limit: 10,
      offset: 0,
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/schedules",
      tenantId: "t1",
      query: {
        enabled: true,
        type: undefined,
        limit: "10",
        offset: "0",
      },
    });
  });

  it("getSchedule delegates with encoded id", async () => {
    await controller.getSchedule(req as never, "s/1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/schedules/s%2F1",
      tenantId: "t1",
    });
  });
});
