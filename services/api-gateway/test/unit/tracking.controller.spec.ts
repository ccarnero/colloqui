import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import { TrackingController } from "../../src/modules/tracking/tracking.controller";
import { TrackingProxyService } from "../../src/modules/tracking/tracking-proxy.service";

describe("TrackingController", () => {
  let controller: TrackingController;
  let proxy: ReturnType<typeof mock>;

  beforeEach(async () => {
    proxy = mock(() =>
      Promise.resolve({ correlationId: "corr-1", events: [] })
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [{ provide: TrackingProxyService, useValue: { proxy } }],
    }).compile();
    controller = moduleRef.get(TrackingController);
  });

  const req = { [REQUEST_TENANT_KEY]: "t1" } as Record<string, unknown>;

  it("getChain delegates to proxy with tenant, path and encoded correlationId", async () => {
    const result = await controller.getChain(req as never, "corr-1");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/chains/corr-1",
      tenantId: "t1",
    });
    expect(result).toEqual({ correlationId: "corr-1", events: [] });
  });

  it("getChain encodes special characters in the correlationId", async () => {
    await controller.getChain(req as never, "corr/1 x");
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/chains/corr%2F1%20x",
      tenantId: "t1",
    });
  });
});
