import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdaptersController } from "../../src/modules/adapters/adapters.controller";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";

describe("AdaptersController", () => {
  let controller: AdaptersController;
  const list = mock(() => Promise.resolve([]));
  const create = mock(() => Promise.resolve({ id: "a1" }));
  const get = mock(() => Promise.resolve(null));
  const update = mock(() => Promise.resolve(null));
  const remove = mock(() => Promise.resolve(undefined));
  const addEndpoint = mock(() => Promise.resolve(null));
  const removeEndpoint = mock(() => Promise.resolve(undefined));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdaptersController],
      providers: [
        {
          provide: AdaptersService,
          useValue: {
            list,
            create,
            get,
            update,
            remove,
            addEndpoint,
            removeEndpoint,
          } as unknown as AdaptersService,
        },
      ],
    }).compile();

    controller = moduleRef.get(AdaptersController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("list delegates to AdaptersService.list with tenant, context, limit, offset", async () => {
    await controller.list("tenant-a", { context: "internal" });
    expect(list).toHaveBeenCalledWith("tenant-a", "internal", 50, 0);
  });

  it("list passes clamped limit and offset", async () => {
    await controller.list("tenant-a", {
      context: "external",
      limit: 10,
      offset: 5,
    });
    expect(list).toHaveBeenCalledWith("tenant-a", "external", 10, 5);
  });

  it("create delegates", async () => {
    const dto = {
      name: "A",
      context: "internal",
      baseUrl: "https://x",
    } as never;
    await controller.create("tenant-a", dto);
    expect(create).toHaveBeenCalledWith("tenant-a", dto);
  });

  it("get delegates", async () => {
    await controller.get("tenant-a", "id1");
    expect(get).toHaveBeenCalledWith("tenant-a", "id1");
  });

  it("update delegates", async () => {
    const dto = { name: "B" } as never;
    await controller.update("tenant-a", "id1", dto);
    expect(update).toHaveBeenCalledWith("tenant-a", "id1", dto);
  });

  it("remove delegates", async () => {
    await controller.remove("tenant-a", "id1");
    expect(remove).toHaveBeenCalledWith("tenant-a", "id1");
  });

  it("addEndpoint and removeEndpoint delegate", async () => {
    const ep = { label: "l", method: "GET", path: "/p" } as never;
    await controller.addEndpoint("tenant-a", "id1", ep);
    expect(addEndpoint).toHaveBeenCalledWith("tenant-a", "id1", ep);
    await controller.removeEndpoint("tenant-a", "id1", "ep1");
    expect(removeEndpoint).toHaveBeenCalledWith(
      "tenant-a",
      "id1",
      "ep1",
    );
  });
});
