import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { RuntimeController } from "../../src/modules/runtime/runtime.controller";
import { RuntimeService } from "../../src/modules/runtime/runtime.service";

describe("RuntimeController", () => {
  let controller: RuntimeController;
  const getStatus = mock(() =>
    Promise.resolve({
      configured: true,
      connected_runtimes: ["r1"],
    }),
  );

  beforeEach(async () => {
    getStatus.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [RuntimeController],
      providers: [{ provide: RuntimeService, useValue: { getStatus } }],
    }).compile();
    controller = moduleRef.get(RuntimeController);
  });

  it("getStatus delegates to RuntimeService", async () => {
    const out = await controller.getStatus("tenant-123");
    expect(getStatus).toHaveBeenCalledWith("tenant-123");
    expect(out.configured).toBe(true);
    expect(out.connected_runtimes).toEqual(["r1"]);
  });
});
