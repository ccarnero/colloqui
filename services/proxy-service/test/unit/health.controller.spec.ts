import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { setActiveTracedFetch } from "../helpers/fake-traced-fetch";

describe("HealthController (proxy-service)", () => {
  let controller: HealthController;
  let tracedFetchMock: ReturnType<typeof mock>;

  beforeEach(async () => {
    tracedFetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    setActiveTracedFetch(tracedFetchMock as never);
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
      Promise.resolve(new Response(null, { status: 503 }))
    );
    const r = await controller.check();
    expect(r).toEqual({
      status: "degraded",
      tenantService: "unreachable",
    });
  });

  it("returns degraded when fetch throws", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.reject(new Error("network"))
    );
    const r = await controller.check();
    expect(r).toEqual({
      status: "degraded",
      tenantService: "unreachable",
    });
  });
});
