import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { SystemVariablesController } = await import(
    "../../src/modules/system-variables/system-variables.controller"
  );
  const { SystemVariablesService } = await import(
    "../../src/modules/system-variables/system-variables.service"
  );
  return { SystemVariablesController, SystemVariablesService };
};

describe("SystemVariablesController", () => {
  let SystemVariablesController: Awaited<
    ReturnType<typeof load>
  >["SystemVariablesController"];
  let controller: InstanceType<typeof SystemVariablesController>;
  let service: Record<string, ReturnType<typeof mock>>;

  beforeEach(async () => {
    const mod = await load();
    SystemVariablesController = mod.SystemVariablesController;
    service = {
      findAll: mock(() => Promise.resolve({ variables: [], total: 0 })),
      findById: mock(() => Promise.resolve(null)),
      create: mock(() => Promise.resolve({ id: "v1", name: "x" })),
      update: mock(() => Promise.resolve({ id: "v1", name: "x" })),
      delete: mock(() => Promise.resolve(true)),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [SystemVariablesController],
      providers: [
        { provide: mod.SystemVariablesService, useValue: service },
      ],
    }).compile();
    controller = moduleRef.get(SystemVariablesController);
  });

  it("findAll calls service.findAll with tenantId", async () => {
    await controller.findAll("t1");
    expect(service.findAll).toHaveBeenCalledWith("t1");
  });

  it("findById calls service.findById with tenantId and id", async () => {
    await controller.findById("t1", "v1");
    expect(service.findById).toHaveBeenCalledWith("t1", "v1");
  });

  it("create calls service.create with tenantId and body", async () => {
    const body = { name: "test", type: "string", value: "hello" };
    await controller.create("t1", body as never);
    expect(service.create).toHaveBeenCalledWith("t1", body);
  });

  it("update calls service.update with tenantId, id, and body", async () => {
    const body = { name: "updated" };
    await controller.update("t1", "v1", body as never);
    expect(service.update).toHaveBeenCalledWith("t1", "v1", body);
  });

  it("delete calls service.delete with tenantId and id", async () => {
    await controller.delete("t1", "v1");
    expect(service.delete).toHaveBeenCalledWith("t1", "v1");
  });
});
