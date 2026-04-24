import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantsController } from "../../src/modules/tenants/tenants.controller";
import { TenantsService } from "../../src/modules/tenants/tenants.service";

describe("TenantsController", () => {
  it("delegates create/list/getOne/update/remove to service", async () => {
    const serviceMock = {
      createTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
      listTenants: mock(() => Promise.resolve([{ name: "tenant-a" }])),
      getTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
      getTenantById: mock(() => Promise.resolve({ id: "u1" })),
      updateTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
      deleteTenant: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: serviceMock }],
    }).compile();

    const controller = moduleRef.get(TenantsController);
    await controller.create({ name: "tenant-a", configuration: {} });
    await controller.list();
    await controller.getOne("tenant-a");
    await controller.getOne("550e8400-e29b-41d4-a716-446655440000");
    await controller.update("tenant-a", { configuration: {} });
    await controller.remove("tenant-a");

    expect(serviceMock.createTenant).toHaveBeenCalledTimes(1);
    expect(serviceMock.listTenants).toHaveBeenCalledTimes(1);
    expect(serviceMock.getTenant).toHaveBeenCalledWith("tenant-a");
    expect(serviceMock.getTenantById).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(serviceMock.updateTenant).toHaveBeenCalledTimes(1);
    expect(serviceMock.deleteTenant).toHaveBeenCalledTimes(1);
  });
});
