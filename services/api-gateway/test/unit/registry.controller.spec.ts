import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { RegistryController } from "../../src/modules/registry/registry.controller";
import { RegistryProxyService } from "../../src/modules/registry/registry-proxy.service";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";

describe("RegistryController", () => {
  let controller: RegistryController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ items: [] }));
    const moduleRef = await Test.createTestingModule({
      controllers: [RegistryController],
      providers: [{ provide: RegistryProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(RegistryController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("listServices delegates to proxy", async () => {
    await controller.listServices(req as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/services",
      tenantId: "t1",
    });
  });

  it("listRevisions delegates with encoded id", async () => {
    await controller.listRevisions(req as never, "svc/a");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/services/svc%2Fa/revisions",
      tenantId: "t1",
    });
  });
});
