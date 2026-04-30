import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { createMockPostgresSql } from "@yoizen/testing";
import { PublicRoutesRepository } from "../../src/modules/public-routes/public-routes.repository";
import { PublicRoutesService } from "../../src/modules/public-routes/public-routes.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import { REDIS_CLIENT } from "@yoizen/database";

function createMockRedis() {
  return {
    set: mock(() => Promise.resolve("OK")),
    get: mock(() => Promise.resolve(null)),
    ping: mock(() => Promise.resolve("PONG")),
  };
}

describe("PublicRoutesService", () => {
  let service: PublicRoutesService;
  let sql: ReturnType<typeof createMockPostgresSql>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    process.env.PLATFORM_ENVIRONMENT = "test";

    sql = createMockPostgresSql(mock);
    redis = createMockRedis();

    const module = await Test.createTestingModule({
      providers: [
        PublicRoutesRepository,
        PublicRoutesService,
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get(PublicRoutesService);
  });

  describe("create", () => {
    it("should create a public route and sync to Redis", async () => {
      const row = {
        id: "pr-1",
        method: "GET",
        path_pattern: "/api/public",
        scope: "platform",
        environment: "test",
        created_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([row]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([row]);

      const result = await service.create({
        method: "GET",
        pathPattern: "/api/public",
        scope: "platform",
      });
      expect(result.method).toBe("GET");
      expect(result.path_pattern).toBe("/api/public");
      expect(redis.set).toHaveBeenCalled();
    });

    it("should sync tenant-scoped Redis key when tenantId is provided", async () => {
      const row = {
        id: "pr-2",
        method: "GET",
        path_pattern: "/events",
        scope: "tenant:demo",
        environment: "test",
        created_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([row]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { method: "GET", path_pattern: "/health", scope: "platform" },
        { method: "GET", path_pattern: "/events", scope: "tenant:demo" },
      ]);
      await service.create({
        method: "GET",
        pathPattern: "/events",
        scope: "tenant:demo",
        tenantId: "demo",
      });
      expect(redis.set.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("list", () => {
    it("should return all routes when no tenantId", async () => {
      const rows = [
        {
          id: "pr-1",
          method: "GET",
          path_pattern: "/a",
          scope: "platform",
          environment: "test",
          created_at: new Date(),
        },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(rows);
      const result = await service.list();
      expect(result).toHaveLength(1);
    });

    it("should filter by tenant scope when tenantId provided", async () => {
      const rows = [
        {
          id: "pr-1",
          method: "POST",
          path_pattern: "/b",
          scope: "tenant:demo",
          environment: "test",
          created_at: new Date(),
        },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(rows);
      const result = await service.list("demo");
      expect(result).toHaveLength(1);
    });
  });

  describe("remove", () => {
    it("should throw NotFoundException if route not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.remove("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should remove route and sync to Redis", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "pr-1" },
      ]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await service.remove("pr-1");
      expect(redis.set).toHaveBeenCalled();
    });
  });

});
