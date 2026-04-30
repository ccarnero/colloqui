import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { RoutesController } from "../../src/modules/routes/routes.controller";
import { RoutesService } from "../../src/modules/routes/routes.service";

describe("RoutesController", () => {
  let controller: RoutesController;
  let discover: ReturnType<typeof mock>;
  let create: ReturnType<typeof mock>;
  let listForService: ReturnType<typeof mock>;
  let remove: ReturnType<typeof mock>;

  beforeEach(async () => {
    discover = mock(() => Promise.resolve([]));
    create = mock(() => Promise.resolve({ id: "r1" }));
    listForService = mock(() => Promise.resolve([]));
    remove = mock(() => Promise.resolve());
    const routesService = {
      create,
      listForService,
      remove,
      discover,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RoutesController],
      providers: [{ provide: RoutesService, useValue: routesService }],
    }).compile();

    controller = moduleRef.get(RoutesController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("discover delegates to RoutesService.discover", async () => {
    await controller.discover();
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("create delegates to RoutesService.create", async () => {
    await controller.create("t1", "svc-1", {
      pathPrefix: "/api",
      methods: ["GET"],
    });
    expect(create).toHaveBeenCalledWith("t1", "svc-1", {
      pathPrefix: "/api",
      methods: ["GET"],
    });
  });

  it("listForService delegates to RoutesService.listForService", async () => {
    await controller.listForService("t1", "svc-1");
    expect(listForService).toHaveBeenCalledWith("t1", "svc-1");
  });

  it("remove delegates to RoutesService.remove", async () => {
    await controller.remove("t1", "svc-1", "route-1");
    expect(remove).toHaveBeenCalledWith("t1", "svc-1", "route-1");
  });
});
