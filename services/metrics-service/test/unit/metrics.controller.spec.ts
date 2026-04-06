import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantGuard } from "@yoizen/database";
import { MetricsController } from "../../src/modules/metrics/metrics.controller";
import { MetricsService } from "../../src/modules/metrics/metrics.service";

const tenantGuardAllow = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    req.tenantId = "test-tenant";
    return true;
  },
};

describe("MetricsController", () => {
  let controller: MetricsController;
  let metricsService: {
    queryMetrics: ReturnType<typeof mock>;
    getMetricById: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    metricsService = {
      queryMetrics: mock(() => Promise.resolve([])),
      getMetricById: mock(() => Promise.resolve(null)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: metricsService }],
    })
      .overrideGuard(TenantGuard)
      .useValue(tenantGuardAllow)
      .compile();

    controller = moduleRef.get(MetricsController);
  });

  it("queryMetrics delegates to service with clamped limit/offset", async () => {
    await controller.queryMetrics("test-tenant", {
      limit: 5000,
      offset: -1,
    } as import("../../src/modules/metrics/metrics.dto").QueryMetricsDto);
    expect(metricsService.queryMetrics).toHaveBeenCalled();
    const call = metricsService.queryMetrics.mock.calls[0];
    expect(call[0].limit).toBe(500);
    expect(call[0].offset).toBeGreaterThanOrEqual(0);
  });

  it("getMetric throws NotFoundException when missing", async () => {
    metricsService.getMetricById.mockResolvedValueOnce(null);
    await expect(
      controller.getMetric(
        "test-tenant",
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getMetric returns metric when found", async () => {
    const row = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      source: "s",
      name: "n",
      value: 1,
      tags: {},
      metadata: {},
      created_at: new Date().toISOString(),
    };
    metricsService.getMetricById.mockResolvedValueOnce(row);
    const out = await controller.getMetric(
      "test-tenant",
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(out).toEqual(row);
  });
});
