import { describe, it, expect, beforeAll, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("RuntimeService", () => {
  let RuntimeService: typeof import("../../src/modules/runtime/runtime.service").RuntimeService;
  let TenantConnectionManager: typeof import("@yoizen/database").TenantConnectionManager;
  let service: InstanceType<
    typeof import("../../src/modules/runtime/runtime.service").RuntimeService
  >;
  let sqlFn: ReturnType<typeof vi.fn>;
  let redisGet: ReturnType<typeof vi.fn>;
  let redisSet: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    process.env.POSTGRES_PASSWORD ??= "test-unit-secret";
    const rs = await import("../../src/modules/runtime/runtime.service");
    const tm = await import("@yoizen/database");
    RuntimeService = rs.RuntimeService;
    TenantConnectionManager = tm.TenantConnectionManager;
  });

  beforeEach(async () => {
    sqlFn = vi.fn(
      (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve([]),
    );
    const mockManager = {
      ensureSchema: vi.fn().mockResolvedValue(sqlFn),
    } as unknown as InstanceType<typeof TenantConnectionManager>;

    redisGet = vi.fn().mockResolvedValue(null);
    redisSet = vi.fn().mockResolvedValue("OK");
    const mockRedis = {
      get: redisGet,
      set: redisSet,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeService,
        { provide: TenantConnectionManager, useValue: mockManager },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(RuntimeService);
  });

  it("returns configured when SELECT 1 succeeds and records last_sync in Redis", async () => {
    const result = await service.getStatus("tenant-a");
    expect(result.configured).toBe(true);
    expect(result.connected_runtimes).toContain("runtime-tenant-a-primary");
    expect(result.last_sync_at).toBeDefined();
    expect(redisSet).toHaveBeenCalled();
  });

  it("returns not configured when DB check throws", async () => {
    sqlFn.mockImplementationOnce(() =>
      Promise.reject(new Error("connection refused")),
    );
    const result = await service.getStatus("tenant-b");
    expect(result.configured).toBe(false);
    expect(result.connected_runtimes).toEqual([]);
  });
});
