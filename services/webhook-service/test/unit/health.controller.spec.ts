import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";
import { REDIS_CLIENT } from "@yoizen/database";

describe("HealthController (webhook-service)", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const mockNats = { isClosed: () => false };
    const mockRedis = {
      ping: mock(() => Promise.resolve("PONG")),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: NATS_CONNECTION, useValue: mockNats },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it("returns ok when NATS is open and Redis pings", async () => {
    const r = await controller.check();
    expect(r).toEqual({
      status: "ok",
      nats: true,
      redis: true,
    });
  });

  it("returns degraded when NATS is closed", async () => {
    const mockNats = { isClosed: () => true };
    const mockRedis = {
      ping: mock(() => Promise.resolve("PONG")),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: NATS_CONNECTION, useValue: mockNats },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    const c = moduleRef.get(HealthController);
    const r = await c.check();
    expect(r.status).toBe("degraded");
    expect(r.nats).toBe(false);
    expect(r.redis).toBe(true);
  });

  it("returns degraded when Redis ping fails", async () => {
    const mockNats = { isClosed: () => false };
    const mockRedis = {
      ping: mock(() => Promise.reject(new Error("down"))),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: NATS_CONNECTION, useValue: mockNats },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    const c = moduleRef.get(HealthController);
    const r = await c.check();
    expect(r.status).toBe("degraded");
    expect(r.nats).toBe(true);
    expect(r.redis).toBe(false);
  });
});
