import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { POSTGRES_SQL } from "../../src/providers/postgres.module";
import { REDIS_CLIENT } from "@yoizen/database";

function createMockMongo(healthy = true) {
  return {
    db: mock(() => ({
      command: mock(() =>
        healthy
          ? Promise.resolve({ ok: 1 })
          : Promise.reject(new Error("down")),
      ),
    })),
  };
}

function createMockPostgres(healthy = true) {
  return mock(() =>
    healthy ? Promise.resolve([{ "?column?": 1 }]) : Promise.reject(new Error("down")),
  );
}

function createMockRedis() {
  return {
    ping: mock(() => Promise.resolve("PONG")),
  };
}

describe("HealthController", () => {
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    redis = createMockRedis();
  });

  afterEach(() => {
    delete process.env.DB_ENGINE;
    delete process.env.STORAGE_ENGINE;
  });

  describe("mongo engine", () => {
    beforeEach(() => {
      process.env.DB_ENGINE = "mongo";
    });

    it("should return ok when both mongo and redis are healthy", async () => {
      const mongo = createMockMongo(true);
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          { provide: MONGO_CLIENT, useValue: mongo },
          { provide: REDIS_CLIENT, useValue: redis },
        ],
      }).compile();

      const controller = module.get(HealthController);
      const result = await controller.check();
      expect(result.status).toBe("ok");
      expect(result.mongo).toBe("connected");
      expect(result.redis).toBe("connected");
    });

    it("should return degraded when mongo is down", async () => {
      const downMongo = createMockMongo(false);
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          { provide: MONGO_CLIENT, useValue: downMongo },
          { provide: REDIS_CLIENT, useValue: redis },
        ],
      }).compile();
      const result = await module.get(HealthController).check();
      expect(result.status).toBe("degraded");
      expect(result.mongo).toBe("disconnected");
      expect(result.redis).toBe("connected");
    });
  });

  describe("postgres engine", () => {
    beforeEach(() => {
      process.env.DB_ENGINE = "postgres";
    });

    it("should return ok when both postgres and redis are healthy", async () => {
      const sql = createMockPostgres(true);
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          { provide: POSTGRES_SQL, useValue: sql },
          { provide: REDIS_CLIENT, useValue: redis },
        ],
      }).compile();

      const result = await module.get(HealthController).check();
      expect(result.status).toBe("ok");
      expect(result.postgres).toBe("connected");
      expect(result.redis).toBe("connected");
    });

    it("should return degraded when postgres is down", async () => {
      const sql = createMockPostgres(false);
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          { provide: POSTGRES_SQL, useValue: sql },
          { provide: REDIS_CLIENT, useValue: redis },
        ],
      }).compile();
      const result = await module.get(HealthController).check();
      expect(result.status).toBe("degraded");
      expect(result.postgres).toBe("disconnected");
      expect(result.redis).toBe("connected");
    });
  });

  it("should return degraded when redis is down (mongo)", async () => {
    process.env.DB_ENGINE = "mongo";
    const mongo = createMockMongo(true);
    redis.ping.mockRejectedValueOnce(new Error("Connection refused"));
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: MONGO_CLIENT, useValue: mongo },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    const result = await module.get(HealthController).check();
    expect(result.status).toBe("degraded");
    expect(result.mongo).toBe("connected");
    expect(result.redis).toBe("disconnected");
  });
});
