import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { createMockMongoClient } from "@yoizen/testing";
import { PublicRoutesMongoRepository } from "../../src/modules/public-routes/public-routes.mongo.repository";
import { PUBLIC_ROUTES_REPOSITORY } from "../../src/modules/public-routes/public-routes.repository.interface";
import { PublicRoutesService } from "../../src/modules/public-routes/public-routes.service";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
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
  let findQueue: unknown[];
  let deleteQueue: unknown[];
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    process.env.PLATFORM_ENVIRONMENT = "test";
    findQueue = [];
    deleteQueue = [];
    redis = createMockRedis();

    const mongoClient = createMockMongoClient(
      new Map([
        [
          "public_routes",
          (operation) => {
            if (operation === "insertOne") {
              return { acknowledged: true };
            }
            if (operation === "find") {
              return findQueue.shift() ?? [];
            }
            if (operation === "deleteOne") {
              return { deletedCount: deleteQueue.shift() === undefined ? 0 : 1 };
            }
            return [];
          },
        ],
      ]),
      mock,
    );

    const module = await Test.createTestingModule({
      providers: [
        PublicRoutesMongoRepository,
        {
          provide: PUBLIC_ROUTES_REPOSITORY,
          useExisting: PublicRoutesMongoRepository,
        },
        PublicRoutesService,
        { provide: MONGO_CLIENT, useValue: mongoClient },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get(PublicRoutesService);
  });

  describe("create", () => {
    it("should create a public route and sync to Redis", async () => {
      findQueue.push([
        {
          method: "GET",
          path_pattern: "/api/public",
          scope: "platform",
        },
      ]);

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
      findQueue.push([
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
      findQueue.push([
        {
          _id: "pr-1",
          method: "GET",
          path_pattern: "/a",
          scope: "platform",
          environment: "test",
          created_at: new Date(),
        },
      ]);
      const result = await service.list();
      expect(result).toHaveLength(1);
    });

    it("should filter by tenant scope when tenantId provided", async () => {
      findQueue.push([
        {
          _id: "pr-1",
          method: "POST",
          path_pattern: "/b",
          scope: "tenant:demo",
          environment: "test",
          created_at: new Date(),
        },
      ]);
      const result = await service.list("demo");
      expect(result).toHaveLength(1);
    });
  });

  describe("remove", () => {
    it("should throw NotFoundException if route not found", async () => {
      deleteQueue.push(undefined);
      await expect(service.remove("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should remove route and sync to Redis", async () => {
      deleteQueue.push(1);
      findQueue.push([]);
      await service.remove("pr-1");
      expect(redis.set).toHaveBeenCalled();
    });
  });
});
