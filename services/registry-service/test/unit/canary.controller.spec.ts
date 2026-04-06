import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { CanaryController } from "../../src/modules/canary/canary.controller";
import { CanaryService } from "../../src/modules/canary/canary.service";

describe("CanaryController", () => {
  let controller: CanaryController;
  let canaryService: {
    start: ReturnType<typeof mock>;
    updatePercent: ReturnType<typeof mock>;
    promote: ReturnType<typeof mock>;
    rollback: ReturnType<typeof mock>;
    getStatus: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    canaryService = {
      start: mock(() => Promise.resolve({ id: "c1" })),
      updatePercent: mock(() => Promise.resolve({ percent: 50 })),
      promote: mock(() => Promise.resolve({ ok: true })),
      rollback: mock(() => Promise.resolve({ ok: true })),
      getStatus: mock(() => Promise.resolve({ status: "active" })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CanaryController],
      providers: [{ provide: CanaryService, useValue: canaryService }],
    }).compile();
    controller = moduleRef.get(CanaryController);
  });

  it("POST start delegates to CanaryService.start", async () => {
    const dto = { image: "img:v2", percent: 10 };
    const r = await controller.start("tenant-a", "svc-1", dto);
    expect(canaryService.start).toHaveBeenCalledWith("tenant-a", "svc-1", dto);
    expect(r).toEqual({ id: "c1" });
  });

  it("PATCH updatePercent delegates to CanaryService.updatePercent", async () => {
    const dto = { percent: 25 };
    await controller.updatePercent("tenant-a", "svc-1", dto);
    expect(canaryService.updatePercent).toHaveBeenCalledWith(
      "tenant-a",
      "svc-1",
      dto,
    );
  });

  it("POST promote delegates to CanaryService.promote", async () => {
    await controller.promote("tenant-a", "svc-1");
    expect(canaryService.promote).toHaveBeenCalledWith("tenant-a", "svc-1");
  });

  it("POST rollback delegates to CanaryService.rollback", async () => {
    await controller.rollback("tenant-a", "svc-1");
    expect(canaryService.rollback).toHaveBeenCalledWith("tenant-a", "svc-1");
  });

  it("GET status delegates to CanaryService.getStatus", async () => {
    const r = await controller.status("tenant-a", "svc-1");
    expect(canaryService.getStatus).toHaveBeenCalledWith("tenant-a", "svc-1");
    expect(r).toEqual({ status: "active" });
  });
});
