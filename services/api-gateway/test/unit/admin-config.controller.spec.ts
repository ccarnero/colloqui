import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdminConfigController } from "../../src/modules/admin/admin-config.controller";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";

describe("AdminConfigController", () => {
  let controller: AdminConfigController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ ok: true }));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminConfigController],
      providers: [{ provide: AdminProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(AdminConfigController);
  });

  const req = { tenantId: "t1" } as never;

  it("listConfigFiles passes numeric limit and offset as strings", async () => {
    await controller.listConfigFiles(req, {
      limit: 10,
      offset: 5,
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/config-files",
      tenantId: "t1",
      query: { limit: "10", offset: "5" },
    });
  });

  it("getConfigFileByPath passes path query", async () => {
    await controller.getConfigFileByPath(req, {
      path: "/cfg.yaml",
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/admin/config-files/file",
      tenantId: "t1",
      query: { path: "/cfg.yaml" },
    });
  });
});
