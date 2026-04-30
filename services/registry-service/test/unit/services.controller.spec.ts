import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { ServicesController } from "../../src/modules/services/services.controller";
import { ServicesService } from "../../src/modules/services/services.service";

describe("ServicesController", () => {
  let controller: ServicesController;
  const list = mock(() => Promise.resolve([]));
  const register = mock(() => Promise.resolve({ id: "s1" }));
  const get = mock(() => Promise.resolve(null));
  const update = mock(() => Promise.resolve(null));
  const remove = mock(() => Promise.resolve(undefined));
  const listRevisions = mock(() => Promise.resolve([]));

  beforeEach(async () => {
    const mockService = {
      list,
      register,
      get,
      update,
      remove,
      listRevisions,
    };
    const module = await Test.createTestingModule({
      controllers: [ServicesController],
      providers: [{ provide: ServicesService, useValue: mockService }],
    }).compile();

    controller = module.get(ServicesController);
  });

  it("list delegates to ServicesService", async () => {
    const r = await controller.list("tenant-x");
    expect(r).toEqual([]);
    expect(list).toHaveBeenCalledWith("tenant-x");
  });

  it("register delegates", async () => {
    const dto = {
      name: "svc",
      image: "img:v1",
    } as never;
    await controller.register("tenant-x", dto);
    expect(register).toHaveBeenCalledWith("tenant-x", dto);
  });

  it("get and update delegate", async () => {
    await controller.get("tenant-x", "id1");
    expect(get).toHaveBeenCalledWith("tenant-x", "id1");
    const patch = { image: "img:v2" } as never;
    await controller.update("tenant-x", "id1", patch);
    expect(update).toHaveBeenCalledWith("tenant-x", "id1", patch);
  });

  it("remove delegates", async () => {
    await controller.remove("tenant-x", "id1");
    expect(remove).toHaveBeenCalledWith("tenant-x", "id1");
  });

  it("listRevisions delegates", async () => {
    await controller.listRevisions("tenant-x", "id1");
    expect(listRevisions).toHaveBeenCalledWith("tenant-x", "id1");
  });
});
