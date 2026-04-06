import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";

let tracedFetchMock: ReturnType<typeof mock>;

mock.module("@yoizen/observability", () => {
  tracedFetchMock = mock(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );
  return { tracedFetch: tracedFetchMock };
});

import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController (proxy-service)", () => {
  let controller: HealthController;

  beforeEach(async () => {
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it("returns ok when tenant-service health succeeds", async () => {
    const r = await controller.check();
    expect(r).toEqual({
      status: "ok",
      tenantService: "reachable",
    });
    expect(tracedFetchMock).toHaveBeenCalled();
  });

  it("returns degraded when tenant-service returns non-OK", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    const r = await controller.check();
    expect(r).toEqual({
      status: "degraded",
      tenantService: "unreachable",
    });
  });

  it("returns degraded when fetch throws", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.reject(new Error("network")),
    );
    const r = await controller.check();
    expect(r).toEqual({
      status: "degraded",
      tenantService: "unreachable",
    });
  });
});
