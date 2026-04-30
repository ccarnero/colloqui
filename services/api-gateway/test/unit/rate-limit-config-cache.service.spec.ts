import { beforeEach, describe, expect, it, mock } from "bun:test";
import { RateLimitConfigCacheService } from "../../src/modules/rate-limit/rate-limit-config-cache.service";

describe("RateLimitConfigCacheService", () => {
  beforeEach(() => {
    process.env.TENANT_SERVICE_URL = "http://tenant.test";
  });

  it("get falls back to defaultConfig for unknown tenant", () => {
    const svc = new RateLimitConfigCacheService();
    const cfg = svc.get("no-such-tenant");
    expect(cfg).toEqual(svc.defaultConfig);
  });

  it("refresh maps tenant rateLimit from tenant service payload", async () => {
    (globalThis as { fetch?: typeof fetch }).fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            {
              name: "tenant-a",
              environment: "dev",
              configuration: {
                rateLimit: {
                  algorithm: "fixed_window",
                  limit: 50,
                  windowMs: 30_000,
                  capacity: 10,
                  refillRate: 5,
                },
              },
            },
          ]),
      }),
    );

    const svc = new RateLimitConfigCacheService();
    await (
      svc as unknown as { refresh: () => Promise<void> }
    ).refresh();

    const cfg = svc.get("tenant-a");
    expect(cfg.algorithm).toBe("fixed_window");
    expect(cfg.limit).toBe(50);
    expect(cfg.windowMs).toBe(30_000);
  });
});
