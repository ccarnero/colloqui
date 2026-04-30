import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { RateLimitService } from "../../src/modules/rate-limit/rate-limit.service";
import { RateLimitConfigCacheService } from "../../src/modules/rate-limit/rate-limit-config-cache.service";
import { FixedWindowStrategy } from "../../src/modules/rate-limit/strategies/fixed-window.strategy";
import { SlidingWindowStrategy } from "../../src/modules/rate-limit/strategies/sliding-window.strategy";
import { TokenBucketStrategy } from "../../src/modules/rate-limit/strategies/token-bucket.strategy";
import { AuthProxyService } from "../../src/modules/auth/auth-proxy.service";
import { TenantsController } from "../../src/modules/tenants/tenants.controller";
import { TenantProxyService } from "../../src/modules/tenants/tenant-proxy.service";

describe("Rate limit, proxy, and tenants controller", () => {
  describe("RateLimitService", () => {
    it("uses token bucket strategy when algorithm is token_bucket", async () => {
      const fixedConsume = mock(() =>
        Promise.resolve({ allowed: true, limit: 10, remaining: 9, resetSeconds: 1 })
      );
      const slidingConsume = mock(() =>
        Promise.resolve({ allowed: true, limit: 10, remaining: 8, resetSeconds: 1 })
      );
      const tokenConsume = mock(() =>
        Promise.resolve({ allowed: true, limit: 20, remaining: 19, resetSeconds: 2 })
      );

      const moduleRef = await Test.createTestingModule({
        providers: [
          RateLimitService,
          {
            provide: RateLimitConfigCacheService,
            useValue: {
              get: mock(() => ({
                algorithm: "token_bucket",
                limit: 20,
                windowSeconds: 60,
              })),
            },
          },
          { provide: FixedWindowStrategy, useValue: { consume: fixedConsume } },
          { provide: SlidingWindowStrategy, useValue: { consume: slidingConsume } },
          { provide: TokenBucketStrategy, useValue: { consume: tokenConsume } },
        ],
      }).compile();

      const service = moduleRef.get(RateLimitService);
      const result = await service.consume("tenant-a");

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
      expect(tokenConsume).toHaveBeenCalledTimes(1);
      expect(fixedConsume).not.toHaveBeenCalled();
      expect(slidingConsume).not.toHaveBeenCalled();
    });
  });

  describe("AuthProxyService", () => {
    beforeEach(() => {
      (globalThis as { fetch?: unknown }).fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: "token",
              token_type: "Bearer",
            }),
        })
      );
    });

    it("forwards login request and returns payload", async () => {
      const service = new AuthProxyService();
      const response = await service.proxy({
        method: "POST",
        path: "/auth/login",
        body: { email: "user@example.com", password: "secret" },
        headers: {},
        tenantId: "tenant-a",
      });

      expect(response).toEqual({
        access_token: "token",
        token_type: "Bearer",
      });
    });
  });

  describe("TenantsController", () => {
    let controller: TenantsController;
    let proxy: {
      getTenant: ReturnType<typeof mock>;
      listTenants: ReturnType<typeof mock>;
      createTenant: ReturnType<typeof mock>;
      updateTenant: ReturnType<typeof mock>;
      deleteTenant: ReturnType<typeof mock>;
    };

    beforeEach(async () => {
      proxy = {
        getTenant: mock(() => Promise.resolve(null)),
        listTenants: mock(() => Promise.resolve({ tenants: [] })),
        createTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
        updateTenant: mock(() => Promise.resolve({ name: "tenant-a" })),
        deleteTenant: mock(() => Promise.resolve(true)),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [TenantsController],
        providers: [{ provide: TenantProxyService, useValue: proxy }],
      }).compile();

      controller = moduleRef.get(TenantsController);
    });

    it("throws NotFoundException when tenant is missing", async () => {
      try {
        await controller.getOne("missing");
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
      }
    });

    it("returns list from proxy service", async () => {
      const payload = await controller.list();
      expect(payload).toEqual({ tenants: [] });
    });
  });
});
