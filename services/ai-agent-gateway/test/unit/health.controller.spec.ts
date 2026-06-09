import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { NATS_CONNECTION } from "@yoizen/database";
import { REDIS_CLIENT } from "@yoizen/database";

describe("HealthController (ai-agent-gateway)", () => {
  const createController = async (
    natsOk: boolean,
    redisOk: boolean,
  ) => {
    const mockNats = { isClosed: mock(() => !natsOk) };
    const mockRedis = {
      ping: redisOk
        ? mock(() => Promise.resolve("PONG"))
        : mock(() => Promise.reject(new Error("connection refused"))),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: NATS_CONNECTION, useValue: mockNats },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    return module.get(HealthController);
  };

  it("should return ok when NATS and Redis are healthy", async () => {
    const controller = await createController(true, true);
    const result = await controller.getHealth();
    expect(result.status).toBe("ok");
    expect(result.nats).toBe("connected");
    expect(result.redis).toBe("connected");
  });

  it("should return degraded when NATS is disconnected", async () => {
    const controller = await createController(false, true);
    const result = await controller.getHealth();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("disconnected");
    expect(result.redis).toBe("connected");
  });

  it("should return degraded when Redis is disconnected", async () => {
    const controller = await createController(true, false);
    const result = await controller.getHealth();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("connected");
    expect(result.redis).toBe("disconnected");
  });

  it("should return degraded when both are down", async () => {
    const controller = await createController(false, false);
    const result = await controller.getHealth();
    expect(result.status).toBe("degraded");
    expect(result.nats).toBe("disconnected");
    expect(result.redis).toBe("disconnected");
  });
});
