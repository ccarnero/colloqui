import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { AdaptersController } from "../../src/modules/adapters/adapters.controller";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";

describe("AdaptersController", () => {
  let controller: AdaptersController;
  let findAll: ReturnType<typeof mock>;

  beforeEach(async () => {
    findAll = mock(() => Promise.resolve({ adapters: [] }));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdaptersController],
      providers: [
        { provide: AdaptersService, useValue: { findAll, findOne: mock() } },
      ],
    }).compile();

    controller = moduleRef.get(AdaptersController);
  });

  it("findAll delegates to AdaptersService.findAll", async () => {
    await controller.findAll("tenant-1");
    expect(findAll).toHaveBeenCalledWith("tenant-1");
  });
});
