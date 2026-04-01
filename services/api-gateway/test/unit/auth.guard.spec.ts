import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { JwtPayload } from "@yoizen/shared";
import { AuthGuard, REQUEST_USER_KEY } from "../../src/guards/auth.guard";
import { IS_PUBLIC_KEY } from "../../src/decorators/public.decorator";
import { SCOPES_KEY } from "../../src/decorators/scopes.decorator";
import { PERMISSIONS_KEY } from "../../src/decorators/permissions.decorator";
import type { JwtService } from "../../src/modules/auth/jwt.service";
import type { PublicRoutesCacheService } from "../../src/modules/auth/public-routes-cache.service";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import type { YoizenRequest } from "../../src/types/yoizen-request";

function createReflector(overrides: {
  isPublic?: boolean;
  scopes?: string[];
  permissions?: string[];
}): Reflector {
  return {
    getAllAndOverride: mock(<T>(key: string | symbol) => {
      if (key === IS_PUBLIC_KEY) return (overrides.isPublic ?? false) as T;
      if (key === SCOPES_KEY) return (overrides.scopes ?? undefined) as T;
      if (key === PERMISSIONS_KEY) return (overrides.permissions ?? undefined) as T;
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
    url: "/v1/resource",
    headers: {},
    query: {},
    ...overrides,
  } as YoizenRequest;
}

const platformPayload: JwtPayload = {
  sub: "user-1",
  type: "user",
  scope: "platform",
  env: "dev",
  iat: 1,
  exp: 2,
};

describe("AuthGuard", () => {
  let defaultVerify: ReturnType<typeof mock>;
  let jwtService: JwtService;
  let publicRoutesCache: PublicRoutesCacheService;

  beforeEach(() => {
    defaultVerify = mock(() => Promise.resolve(platformPayload));
    jwtService = { verify: defaultVerify } as unknown as JwtService;
    publicRoutesCache = {
      getPublicRoutes: mock(() => Promise.resolve([])),
      isMatch: mock(() => false),
    } as unknown as PublicRoutesCacheService;
  });

  it("allows access when route is decorated @Public()", async () => {
    const reflector = createReflector({ isPublic: true });
    const guard = new AuthGuard(reflector, jwtService, publicRoutesCache);
    const ctx = createContext(baseRequest());

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(defaultVerify).not.toHaveBeenCalled();
  });

  it("allows access when method and path match a dynamic public route", async () => {
    const reflector = createReflector({});
    const cache = {
      getPublicRoutes: mock(() =>
        Promise.resolve([
          { method: "POST", path: "/auth/token", scope: "platform" },
        ]),
      ),
      isMatch: mock(() => true),
    } as unknown as PublicRoutesCacheService;
    const guard = new AuthGuard(reflector, jwtService, cache);
    const req = baseRequest({ method: "POST", url: "/auth/token" });
    const ctx = createContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(defaultVerify).not.toHaveBeenCalled();
  });

  it("allows access when Bearer JWT verifies and tenant scope matches", async () => {
    const tenantPayload: JwtPayload = {
      ...platformPayload,
      scope: "tenant:acme",
    };
    const verify = mock(() => Promise.resolve(tenantPayload));
    const reflector = createReflector({});
    const guard = new AuthGuard(
      reflector,
      { verify } as unknown as JwtService,
      publicRoutesCache,
    );
    const req = baseRequest({
      headers: { authorization: "Bearer valid.jwt" },
      [REQUEST_TENANT_KEY]: "acme",
    } as YoizenRequest);
    const ctx = createContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req[REQUEST_USER_KEY]).toEqual(tenantPayload);
  });

  it("allows platform-scoped token when request has a tenant context", async () => {
    const reflector = createReflector({});
    const guard = new AuthGuard(reflector, jwtService, publicRoutesCache);
    const req = baseRequest({
      headers: { authorization: "Bearer valid.jwt" },
      [REQUEST_TENANT_KEY]: "acme",
    } as YoizenRequest);
    const ctx = createContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("throws UnauthorizedException when Authorization header is missing", async () => {
    const reflector = createReflector({});
    const guard = new AuthGuard(reflector, jwtService, publicRoutesCache);
    const ctx = createContext(baseRequest());

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("throws UnauthorizedException when JWT verification fails", async () => {
    const verify = mock(() =>
      Promise.reject(new UnauthorizedException("Invalid or expired token")),
    );
    const reflector = createReflector({});
    const guard = new AuthGuard(
      reflector,
      { verify } as unknown as JwtService,
      publicRoutesCache,
    );
    const ctx = createContext(
      baseRequest({ headers: { authorization: "Bearer bad" } }),
    );

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("throws ForbiddenException when tenant scope does not match request tenant", async () => {
    const tenantPayload: JwtPayload = {
      ...platformPayload,
      scope: "tenant:other",
    };
    const verify = mock(() => Promise.resolve(tenantPayload));
    const reflector = createReflector({});
    const guard = new AuthGuard(
      reflector,
      { verify } as unknown as JwtService,
      publicRoutesCache,
    );
    const req = baseRequest({
      headers: { authorization: "Bearer valid.jwt" },
      [REQUEST_TENANT_KEY]: "acme",
    } as YoizenRequest);
    const ctx = createContext(req);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("enforces @Scopes platform by rejecting tenant-scoped tokens", async () => {
    const tenantPayload: JwtPayload = {
      ...platformPayload,
      scope: "tenant:acme",
    };
    const verify = mock(() => Promise.resolve(tenantPayload));
    const reflector = createReflector({ scopes: ["platform"] });
    const guard = new AuthGuard(
      reflector,
      { verify } as unknown as JwtService,
      publicRoutesCache,
    );
    const req = baseRequest({
      headers: { authorization: "Bearer valid.jwt" },
      [REQUEST_TENANT_KEY]: "acme",
    } as YoizenRequest);
    const ctx = createContext(req);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows tenant-scoped token when @Scopes requires tenant", async () => {
    const tenantPayload: JwtPayload = {
      ...platformPayload,
      scope: "tenant:acme",
    };
    const verify = mock(() => Promise.resolve(tenantPayload));
    const reflector = createReflector({ scopes: ["tenant"] });
    const guard = new AuthGuard(
      reflector,
      { verify } as unknown as JwtService,
      publicRoutesCache,
    );
    const req = baseRequest({
      headers: { authorization: "Bearer valid.jwt" },
      [REQUEST_TENANT_KEY]: "acme",
    } as YoizenRequest);
    const ctx = createContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
