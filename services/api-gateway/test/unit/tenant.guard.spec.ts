import { describe, it, expect, mock } from "bun:test";
import { BadRequestException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { TENANT_HEADER } from "@yoizen/shared";
import {
  TenantGuard,
  REQUEST_TENANT_KEY,
} from "../../src/guards/tenant.guard";
import { SKIP_TENANT_KEY } from "../../src/decorators/skip-tenant.decorator";
import type { YoizenRequest } from "../../src/types/yoizen-request";

function createReflector(skipTenant?: boolean): Reflector {
  return {
    getAllAndOverride: mock(<T>(key: string | symbol) => {
      if (key === SKIP_TENANT_KEY) return (skipTenant ?? false) as T;
      return undefined as T;
    }),
  } as unknown as Reflector;
}

function createContext(request: YoizenRequest): ExecutionContext {
  const noop = () => {};
  return {
    getHandler: () => noop,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function baseRequest(overrides: Partial<YoizenRequest> = {}): YoizenRequest {
  return {
    method: "GET",
    url: "/x",
    headers: {},
    query: {},
    ...overrides,
  } as YoizenRequest;
}

describe("TenantGuard", () => {
  it("resolves tenant from x-yoizen-tenant header when host does not match pattern", () => {
    const guard = new TenantGuard(createReflector(false));
    const req = baseRequest({
      headers: { host: "localhost:3000", [TENANT_HEADER]: "from-header" },
    });
    const ctx = createContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req[REQUEST_TENANT_KEY]).toBe("from-header");
    expect(req.headers[TENANT_HEADER]).toBe("from-header");
  });

  it("resolves tenant from hostname dev.<tenant>.yplatform.com", () => {
    const guard = new TenantGuard(createReflector(false));
    const req = baseRequest({
      headers: { host: "dev.acme-corp.yplatform.com" },
    });
    const ctx = createContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req[REQUEST_TENANT_KEY]).toBe("acme-corp");
  });

  it("returns true without setting tenant when @SkipTenant() applies", () => {
    const guard = new TenantGuard(createReflector(true));
    const req = baseRequest({
      headers: { host: "localhost:3000" },
    });
    const ctx = createContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req[REQUEST_TENANT_KEY]).toBeUndefined();
  });

  it("throws BadRequestException when tenant cannot be resolved", () => {
    const guard = new TenantGuard(createReflector(false));
    const req = baseRequest({
      headers: { host: "localhost:3000" },
      query: {},
    });
    const ctx = createContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(BadRequestException);
    expect(() => guard.canActivate(ctx)).toThrow(/Tenant context required/);
  });

  it("resolves tenant from query when header and host do not provide it", () => {
    const guard = new TenantGuard(createReflector(false));
    const req = baseRequest({
      headers: { host: "api.example.com" },
      query: { tenant: "query-tenant" },
    });
    const ctx = createContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req[REQUEST_TENANT_KEY]).toBe("query-tenant");
  });
});
