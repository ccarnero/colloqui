import "./preload-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { REDIS_CLIENT } from "@yoizen/database";
import { CacheService } from "../../src/modules/cache/cache.service";

/** Minimal ioredis pipeline chain for tests (chaining `get` returns `this`). */
interface IoredisPipelineStub {
  get(key: string): IoredisPipelineStub;
  exec(): Promise<unknown>;
}

describe("CacheService", () => {
  let service: CacheService;
  let mockRedis: Record<string, ReturnType<typeof mock>>;

  beforeEach(async () => {
    mockRedis = {
      get: mock(() => Promise.resolve(null)),
      // PTTL is issued alongside every Redis GET so the L1 backfill inherits
      // the key's remaining TTL. -1 = "key exists, no TTL" (the default here).
      pttl: mock(() => Promise.resolve(-1)),
      set: mock(() => Promise.resolve("OK")),
      del: mock(() => Promise.resolve(1)),
      scan: mock(() => Promise.resolve(["0", []])),
      pipeline: mock(() => {
        const pipelineMock: IoredisPipelineStub = {
          get: mock(function (this: IoredisPipelineStub) {
            return this;
          }),
          exec: mock(() => Promise.resolve([])),
        };
        return pipelineMock;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [CacheService, { provide: REDIS_CLIENT, useValue: mockRedis }],
    }).compile();

    service = module.get(CacheService);
  });

  describe("get", () => {
    it("should return from L1 on cache hit", async () => {
      await service.set("key1", { data: "hello" });
      mockRedis.get = mock(() => Promise.resolve(null));

      const result = await service.get("key1");
      expect(result).toEqual({ data: "hello" });
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it("should fallback to Redis on L1 miss", async () => {
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify({ x: 1 })));
      const result = await service.get("miss");
      expect(result).toEqual({ x: 1 });
      expect(mockRedis.get).toHaveBeenCalledWith("miss");
    });

    it("should return null when not in L1 or Redis", async () => {
      const result = await service.get("nonexistent");
      expect(result).toBeNull();
    });

    it("should evict expired L1 entries and fallback to Redis", async () => {
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = () => currentTime;

      await service.set("expiring", "val", 1);

      currentTime = 1000000 + 2000;
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify("fresh")));

      const result = await service.get("expiring");
      expect(result).toBe("fresh");
      expect(mockRedis.get).toHaveBeenCalledWith("expiring");

      Date.now = originalNow;
    });

    it("should return raw string if Redis value is not valid JSON", async () => {
      mockRedis.get = mock(() => Promise.resolve("not-json"));
      const result = await service.get("raw");
      expect(result).toBe("not-json");
    });

    /**
     * Regression: the Redis-hit backfill used to write L1 with `expiry: 0`
     * ("never expires"), so a key whose TTL was set by another writer (a second
     * replica, or any direct Redis client) stayed readable from L1 forever
     * after Redis had expired it.
     */
    it("should backfill L1 with the key's remaining Redis TTL", async () => {
      const originalNow = Date.now;
      let currentTime = 5_000_000;
      Date.now = () => currentTime;

      mockRedis.get = mock(() => Promise.resolve(JSON.stringify("ttl-value")));
      mockRedis.pttl = mock(() => Promise.resolve(1000));

      expect(await service.get("elsewhere")).toBe("ttl-value");
      expect(mockRedis.pttl).toHaveBeenCalledWith("elsewhere");

      // Still within the inherited TTL: served from L1, Redis untouched.
      currentTime = 5_000_000 + 500;
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify("ttl-value")));
      expect(await service.get("elsewhere")).toBe("ttl-value");
      expect(mockRedis.get).not.toHaveBeenCalled();

      // Past the inherited TTL: L1 entry is dropped and Redis decides.
      currentTime = 5_000_000 + 1500;
      mockRedis.get = mock(() => Promise.resolve(null));
      expect(await service.get("elsewhere")).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith("elsewhere");

      Date.now = originalNow;
    });

    it("should not backfill L1 when PTTL reports the key is already gone", async () => {
      // GET and PTTL are not atomic: -2 means the key expired between them, so
      // caching the value would resurrect an already-dead entry.
      mockRedis.get = mock(() => Promise.resolve(JSON.stringify("racy")));
      mockRedis.pttl = mock(() => Promise.resolve(-2));

      expect(await service.get("racy")).toBe("racy");

      mockRedis.get = mock(() => Promise.resolve(null));
      expect(await service.get("racy")).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith("racy");
    });
  });

  describe("set", () => {
    it("should set in Redis with TTL when provided", async () => {
      await service.set("key", "value", 300);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "key",
        JSON.stringify("value"),
        "EX",
        300
      );
    });

    it("should set in Redis without TTL when not provided", async () => {
      await service.set("key", "value");
      expect(mockRedis.set).toHaveBeenCalledWith(
        "key",
        JSON.stringify("value")
      );
    });

    it("should update L1 cache", async () => {
      await service.set("k", { nested: true });
      mockRedis.get = mock(() => Promise.resolve(null));
      const result = await service.get("k");
      expect(result).toEqual({ nested: true });
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe("del", () => {
    it("should delete from both Redis and L1", async () => {
      await service.set("delme", "val");
      await service.del("delme");

      expect(mockRedis.del).toHaveBeenCalledWith("delme");

      mockRedis.get = mock(() => Promise.resolve(null));
      const result = await service.get("delme");
      expect(result).toBeNull();
    });
  });

  describe("scan", () => {
    it("should collect keys from all scan pages", async () => {
      let callCount = 0;
      mockRedis.scan = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(["1", ["a", "b"]]);
        }
        return Promise.resolve(["0", ["c"]]);
      });

      const keys = await service.scan("*", 10);
      expect(keys).toEqual(["a", "b", "c"]);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });
  });

  describe("batchGet", () => {
    it("should return empty Map for empty keys array", async () => {
      const result = await service.batchGet([]);
      expect(result.size).toBe(0);
    });

    it("should use pipeline for batch Redis GET", async () => {
      const pipelineMock: IoredisPipelineStub = {
        get: mock(function (this: IoredisPipelineStub) {
          return this;
        }),
        exec: mock(() =>
          Promise.resolve([
            [null, JSON.stringify({ a: 1 })],
            [null, JSON.stringify({ b: 2 })],
          ])
        ),
      };
      mockRedis.pipeline = mock(() => pipelineMock);

      const result = await service.batchGet(["k1", "k2"]);
      expect(result).toBeInstanceOf(Map);
      expect(result.get("k1")).toEqual({ a: 1 });
      expect(result.get("k2")).toEqual({ b: 2 });
      expect(pipelineMock.get).toHaveBeenCalledTimes(2);
    });

    it("should skip keys with errors in pipeline response", async () => {
      const pipelineMock: IoredisPipelineStub = {
        get: mock(function (this: IoredisPipelineStub) {
          return this;
        }),
        exec: mock(() =>
          Promise.resolve([
            [new Error("fail"), null],
            [null, JSON.stringify("ok")],
          ])
        ),
      };
      mockRedis.pipeline = mock(() => pipelineMock);

      const result = await service.batchGet(["bad", "good"]);
      expect(result.has("bad")).toBe(false);
      expect(result.get("good")).toBe("ok");
    });
  });

  describe("L1 eviction", () => {
    it("should evict oldest entry when L1 exceeds max size", async () => {
      for (let i = 0; i < 5; i++) {
        await service.set(`k${i}`, i);
      }

      await service.set("k-new", "new");

      mockRedis.get = mock(() => Promise.resolve(null));
      const evicted = await service.get("k0");
      expect(evicted).toBeNull();

      const stillCached = await service.get("k1");
      expect(stillCached).toBe(1);
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });
  });
});
