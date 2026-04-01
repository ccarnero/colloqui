import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Client } from "@temporalio/client";
import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController", () => {
  let controller: HealthController;
  let mockTemporal: { workflowService: { getSystemInfo: ReturnType<typeof mock> } };

  beforeEach(async () => {
    mockTemporal = {
      workflowService: {
        getSystemInfo: mock(() => Promise.resolve({})),
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: "TEMPORAL_CLIENT",
          useValue: mockTemporal as unknown as Client,
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it("returns ok when Temporal responds", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.temporal).toBe(true);
  });

  it("returns degraded when Temporal fails", async () => {
    mockTemporal.workflowService.getSystemInfo.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.temporal).toBe(false);
  });
});
