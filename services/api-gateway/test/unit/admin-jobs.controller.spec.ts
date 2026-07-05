import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdminJobsController } from "../../src/modules/admin/admin-jobs.controller";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";

const UUID = "00000000-0000-4000-8000-000000000001";

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

  it("triggerJob renames the gateway's `payload` field to `event_payload` for the downstream body", async () => {
    const body = { payload: { foo: "bar" } } as never;
    await controller.triggerJob(req, UUID, body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: `/admin/jobs/${UUID}/trigger`,
      tenantId: "t1",
      body: { event_payload: { foo: "bar" } },
    });
  });

  it("triggerJob forwards undefined event_payload when no payload is given", async () => {
    const body = {} as never;
    await controller.triggerJob(req, UUID, body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: `/admin/jobs/${UUID}/trigger`,
      tenantId: "t1",
      body: { event_payload: undefined },
    });
  });
});
