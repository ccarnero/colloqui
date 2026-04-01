import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

function createMockSql() {
  const fn = mock((..._args: unknown[]) => Promise.resolve([{ "?column?": 1 }]));
  return fn as unknown as ReturnType<typeof import("postgres")>;
}

function createMockRedis() {
  return {
    ping: mock(() => Promise.resolve("PONG")),
  };
}

describe("HealthController", () => {
  let controller: HealthController;
  let sql: ReturnType<typeof createMockSql>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    sql = createMockSql();
    redis = createMockRedis();

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("should return ok when both postgres and redis are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.postgres).toBe("connected");
    expect(result.redis).toBe("connected");
  });

  it("should return degraded when postgres is down", async () => {
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe("disconnected");
    expect(result.redis).toBe("connected");
  });

  it("should return degraded when redis is down", async () => {
    redis.ping.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe("connected");
    expect(result.redis).toBe("disconnected");
  });

  it("should return degraded when both are down", async () => {
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );
    redis.ping.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe("disconnected");
    expect(result.redis).toBe("disconnected");
  });
});
