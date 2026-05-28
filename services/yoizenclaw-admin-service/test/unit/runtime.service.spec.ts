import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { RuntimeService } from "../../src/modules/runtime/runtime.service";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { REDIS_CLIENT } from "../../src/providers/redis.provider";

describe("RuntimeService", () => {
  let service: RuntimeService;
  let pingFn: ReturnType<typeof mock>;
  let redisGet: ReturnType<typeof mock>;
  let redisSet: ReturnType<typeof mock>;

  beforeEach(async () => {
    pingFn = mock(async () => ({ ok: 1 }));
    const db = { command: pingFn };
    const mockManager = {
      ensureSchema: mock(async () => db),
    };

    redisGet = mock(async () => null);
    redisSet = mock(async () => "OK");

    const module = await Test.createTestingModule({
      providers: [
        RuntimeService,
        { provide: YoizenclawTenantConnectionManager, useValue: mockManager },
        { provide: REDIS_CLIENT, useValue: { get: redisGet, set: redisSet } },
      ],
    }).compile();

    service = module.get(RuntimeService);
  });

  it("returns configured when ping succeeds and records last_sync in Redis", async () => {
    const result = await service.getStatus("tenant-a");
    expect(result.configured).toBe(true);
    expect(result.connected_runtimes).toContain("runtime-tenant-a-primary");
    expect(result.last_sync_at).toBeDefined();
    expect(redisSet).toHaveBeenCalled();
  });

  it("returns not configured when DB check throws", async () => {
    pingFn.mockImplementationOnce(() =>
      Promise.reject(new Error("connection refused")),
    );
    const result = await service.getStatus("tenant-b");
    expect(result.configured).toBe(false);
    expect(result.connected_runtimes).toEqual([]);
  });
});
