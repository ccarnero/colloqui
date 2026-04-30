import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { REDIS_CLIENT } from "@yoizen/database";

describe("HealthController (cache-service)", () => {
  const createController = async (redisOk: boolean) => {
    const mockRedis = {
      ping: redisOk
        ? mock(() => Promise.resolve("PONG"))
        : mock(() => Promise.reject(new Error("connection refused"))),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: REDIS_CLIENT, useValue: mockRedis }],
    }).compile();

    return module.get(HealthController);
  };

  it("should return ok when Redis is connected", async () => {
    const controller = await createController(true);
    const result = await controller.check();
    expect(result).toEqual({ status: "ok", redis: "connected" });
  });

  it("should return degraded when Redis ping fails", async () => {
    const controller = await createController(false);
    const result = await controller.check();
    expect(result).toEqual({ status: "degraded", redis: "disconnected" });
  });
});
