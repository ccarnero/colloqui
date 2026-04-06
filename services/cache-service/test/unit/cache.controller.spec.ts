import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { CacheController } from "../../src/modules/cache/cache.controller";
import { CacheService } from "../../src/modules/cache/cache.service";
import { REDIS_CLIENT } from "@yoizen/database";

const TENANT_ID = "test-tenant";

describe("CacheController", () => {
  let controller: CacheController;
  let service: CacheService;

  beforeEach(async () => {
    const mockRedis = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve("OK")),
      del: mock(() => Promise.resolve(1)),
      scan: mock(() => Promise.resolve(["0", []])),
      pipeline: mock(() => ({
        get: mock(function (this: unknown) {
          return this;
        }),
        exec: mock(() => Promise.resolve([])),
      })),
    };

    const module = await Test.createTestingModule({
      controllers: [CacheController],
      providers: [CacheService, { provide: REDIS_CLIENT, useValue: mockRedis }],
    }).compile();

    controller = module.get(CacheController);
    service = module.get(CacheService);
  });

  describe("GET /cache/:key", () => {
    it("should return value from service", async () => {
      service.get = mock(() =>
        Promise.resolve({ data: "hello" }),
      ) as CacheService["get"];
      const result = await controller.get(TENANT_ID, "mykey");
      expect(result).toEqual({ data: "hello" });
    });
  });

  describe("PUT /cache/:key", () => {
    it("should call set and return ok", async () => {
      service.set = mock(() => Promise.resolve()) as CacheService["set"];
      const result = await controller.set(TENANT_ID, "mykey", {
        value: "data",
        ttl: 300,
      });
      expect(result).toEqual({ ok: true });
      expect(service.set).toHaveBeenCalledWith(
        `${TENANT_ID}:mykey`,
        "data",
        300,
      );
    });
  });

  describe("DELETE /cache/:key", () => {
    it("should call del and return ok", async () => {
      service.del = mock(() => Promise.resolve()) as CacheService["del"];
      const result = await controller.del(TENANT_ID, "mykey");
      expect(result).toEqual({ ok: true });
      expect(service.del).toHaveBeenCalledWith(`${TENANT_ID}:mykey`);
    });
  });

  describe("GET /cache (listKeys)", () => {
    it("should return keys from scan", async () => {
      service.scan = mock(() => Promise.resolve(["a", "b"])) as CacheService["scan"];
      const result = await controller.listKeys(TENANT_ID, {
        pattern: "test*",
        count: 50,
      });
      expect(result).toEqual(["a", "b"]);
      expect(service.scan).toHaveBeenCalledWith(`${TENANT_ID}:test*`, 50);
    });

    it("should use defaults when no params provided", async () => {
      service.scan = mock(() => Promise.resolve([])) as CacheService["scan"];
      await controller.listKeys(undefined, { pattern: "*", count: 100 });
      expect(service.scan).toHaveBeenCalledWith("*", 100);
    });
  });

  describe("POST /cache/batch", () => {
    it("should return object from batchGet Map", async () => {
      const map = new Map<string, unknown>([
        [`${TENANT_ID}:k1`, "v1"],
        [`${TENANT_ID}:k2`, "v2"],
      ]);
      service.batchGet = mock(() => Promise.resolve(map)) as CacheService["batchGet"];
      const result = await controller.batchGet(TENANT_ID, {
        keys: ["k1", "k2"],
      });
      expect(result).toEqual({
        [`${TENANT_ID}:k1`]: "v1",
        [`${TENANT_ID}:k2`]: "v2",
      });
    });
  });
});
