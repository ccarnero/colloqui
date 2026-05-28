process.env.DB_ENGINE = "mongo";

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";

describe("HealthController", () => {
  let controller: HealthController;
  let mongo: { db: ReturnType<typeof mock> };
  let nc: { isClosed: ReturnType<typeof mock> };

  beforeEach(async () => {
    mongo = {
      db: mock(() => ({
        command: mock(async () => ({ ok: 1 })),
      })),
    };
    nc = {
      isClosed: mock(() => false),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: MONGO_CLIENT, useValue: mongo },
        { provide: NATS_CONNECTION, useValue: nc },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("returns ok when mongo and NATS are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.mongo).toBe("connected");
    expect(result.nats).toBe("connected");
  });

  it("returns degraded when mongo fails", async () => {
    mongo.db.mockReturnValueOnce({
      command: mock(async () => {
        throw new Error("connection refused");
      }),
    });
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.mongo).toBe("disconnected");
    expect(result.nats).toBe("connected");
  });

  it("returns degraded when NATS connection is closed", async () => {
    nc.isClosed.mockReturnValueOnce(true);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.mongo).toBe("connected");
    expect(result.nats).toBe("disconnected");
  });
});
