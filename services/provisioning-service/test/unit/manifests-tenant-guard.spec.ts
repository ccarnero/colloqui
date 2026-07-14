import "../setup-env";
import { describe, expect, it } from "bun:test";
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { ManifestsController } from "../../src/modules/manifests/manifests.controller";

/**
 * `TenantGuard` (from `@yoizen/database`) rejects requests without a valid
 * `x-yoizen-tenant` header before any controller method runs. This test
 * exercises the guard directly (the same instance wired via `@UseGuards`
 * on `ManifestsController`) so every manifests route is proven to require
 * tenant isolation, not just the ones covered by service/controller specs.
 */
describe("ManifestsController tenant isolation guard", () => {
  it("is decorated with @UseGuards(TenantGuard)", () => {
    const guards = Reflect.getMetadata("__guards__", ManifestsController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards?.some((guard) => guard === TenantGuard)).toBe(true);
  });

  it("rejects a request with no x-yoizen-tenant header", () => {
    const guard = new TenantGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as unknown as Parameters<TenantGuard["canActivate"]>[0];

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it("rejects a malformed tenant id", () => {
    const guard = new TenantGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { "x-yoizen-tenant": "a" } }),
      }),
    } as unknown as Parameters<TenantGuard["canActivate"]>[0];

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it("accepts a valid tenant id and sets request.tenantId", () => {
    const guard = new TenantGuard();
    const request: { headers: Record<string, string>; tenantId?: string } = {
      headers: { "x-yoizen-tenant": "tenant-a" },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as Parameters<TenantGuard["canActivate"]>[0];

    expect(guard.canActivate(context)).toBe(true);
    expect(request.tenantId).toBe("tenant-a");
  });

  it("TenantId decorator exists for controller param extraction", () => {
    expect(typeof TenantId).toBe("function");
  });
});
