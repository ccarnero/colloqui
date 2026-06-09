import "../setup-env";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { ConfigFilesController } = await import(
    "../../src/modules/config-files/config-files.controller"
  );
  const { ConfigFilesService } = await import(
    "../../src/modules/config-files/config-files.service"
  );
  return { ConfigFilesController, ConfigFilesService };
};

describe("ConfigFilesController", () => {
  let ConfigFilesController: Awaited<
    ReturnType<typeof load>
  >["ConfigFilesController"];
  let controller: InstanceType<typeof ConfigFilesController>;
  let configFilesService: Record<string, ReturnType<typeof mock>>;

  beforeEach(async () => {
    const mod = await load();
    ConfigFilesController = mod.ConfigFilesController;
    configFilesService = {
      findAll: mock(() => Promise.resolve({ files: [], total: 0 })),
      findByPath: mock(() => Promise.resolve({ id: "f1" })),
      createOrUpdate: mock(() => Promise.resolve({ id: "f1" })),
      deploy: mock(() =>
        Promise.resolve({ files: [], eventEmitted: true }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ConfigFilesController],
      providers: [
        { provide: mod.ConfigFilesService, useValue: configFilesService },
      ],
    }).compile();
    controller = moduleRef.get(ConfigFilesController);
  });

  it("deploy delegates deletePaths to service", async () => {
    await controller.deploy("t1", { deletePaths: ["/x"] } as never);
    expect(configFilesService.deploy).toHaveBeenCalledWith("t1", ["/x"]);
  });
});
