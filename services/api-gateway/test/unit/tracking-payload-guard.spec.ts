// T04 of manual-loops/payload-capture.md: verifies the payload endpoint's
// tenant-admin guard end-to-end through the REAL `AuthGuard` (not a stub),
// reading the REAL decorator metadata off `TrackingController.getPayload` —
// same pattern as auth.guard.spec.ts, applied to the precedent it follows
// (`@Scopes("platform", "tenant")` + `@RequirePermission(...)`, mirrored
// from AuthController's tenant-roles routes).
import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JwtPayload } from "@yoizen/shared";
import { AuthGuard, REQUEST_USER_KEY } from "../../src/guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import type { JwtService } from "../../src/modules/auth/jwt.service";
import type { PublicRoutesCacheService } from "../../src/modules/auth/public-routes-cache.service";
import { TrackingController } from "../../src/modules/tracking/tracking.controller";
import type { IYoizenRequest } from "../../src/types/yoizen-request";

function createContext(request: IYoizenRequest): ExecutionContext {
  return {
    getHandler: () => TrackingController.prototype.getPayload,
    getClass: () => TrackingController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function baseRequest(overrides: Partial<IYoizenRequest> = {}): IYoizenRequest {
  return {
    method: "GET",
    url: "/tracking/chains/corr-1/events/evt-1/payload",
    headers: { authorization: "Bearer valid.jwt" },
    query: {},
    [REQUEST_TENANT_KEY]: "acme",
    ...overrides,
  } as IYoizenRequest;
}

describe("GET tracking/chains/:correlationId/events/:eventId/payload — AuthGuard enforcement", () => {
  let jwtService: JwtService;
  let publicRoutesCache: PublicRoutesCacheService;
  const reflector = new Reflector();

  beforeEach(() => {
    publicRoutesCache = {
      getPublicRoutes: mock(() => Promise.resolve([])),
      isMatch: mock(() => false),
    } as unknown as PublicRoutesCacheService;
  });

  function guardWith(payload: JwtPayload): AuthGuard {
    jwtService = {
      verify: mock(() => Promise.resolve(payload)),
    } as unknown as JwtService;
    return new AuthGuard(reflector, jwtService, publicRoutesCache);
  }

  it("rejects a tenant-scoped caller with no permissions (non-admin)", async () => {
    const guard = guardWith({
      sub: "user-1",
      type: "user",
      scope: "tenant:acme",
      env: "dev",
      iat: 1,
      exp: 2,
      permissions: [],
    } as unknown as JwtPayload);

    await expect(
      guard.canActivate(createContext(baseRequest()))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a tenant-scoped caller missing the tracking:payload:read permission", async () => {
    const guard = guardWith({
      sub: "user-1",
      type: "user",
      scope: "tenant:acme",
      env: "dev",
      iat: 1,
      exp: 2,
      permissions: ["some:other:permission"],
    } as unknown as JwtPayload);

    await expect(
      guard.canActivate(createContext(baseRequest()))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows a tenant_admin caller (wildcard permissions: ['*'])", async () => {
    const guard = guardWith({
      sub: "admin-1",
      type: "user",
      scope: "tenant:acme",
      env: "dev",
      iat: 1,
      exp: 2,
      permissions: ["*"],
    } as unknown as JwtPayload);

    const req = baseRequest();
    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect(req[REQUEST_USER_KEY]?.sub).toBe("admin-1");
  });

  it("allows a caller with the exact tracking:payload:read permission", async () => {
    const guard = guardWith({
      sub: "user-2",
      type: "user",
      scope: "tenant:acme",
      env: "dev",
      iat: 1,
      exp: 2,
      permissions: ["tracking:payload:read"],
    } as unknown as JwtPayload);

    await expect(guard.canActivate(createContext(baseRequest()))).resolves.toBe(
      true
    );
  });

  it("allows a platform-scoped caller regardless of permissions", async () => {
    const guard = guardWith({
      sub: "platform-1",
      type: "user",
      scope: "platform",
      env: "dev",
      iat: 1,
      exp: 2,
    } as unknown as JwtPayload);

    await expect(guard.canActivate(createContext(baseRequest()))).resolves.toBe(
      true
    );
  });
});
