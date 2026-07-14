import "reflect-metadata";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
/**
 * Contract tests for T03 of manual-loops/connector-invoke-api.md:
 * `POST /api/v1/connectors/:connectorId/endpoints/:endpointId/invoke`.
 *
 * - No `@Public()` decorator on the route (repo convention — asserted
 *   directly against the reflector metadata, same guard the global
 *   `AuthGuard` reads).
 * - Payload passthrough: connectorId/endpointId are percent-decoded from
 *   the URL then re-encoded into the facade path; the JSON body travels
 *   verbatim to `ConnectorInvokeProxyService.proxy`.
 * - Downstream status/body mapping (200/400/429/502/503/504): the proxy
 *   service throws the same `HttpException` shape `throwProxyError`
 *   produces for every other proxy in this gateway
 *   (`utils/proxy-error.util.ts`) — this suite verifies the controller/
 *   `ServiceExceptionFilter` pipeline surfaces those statuses unmodified.
 *
 * Cross-tenant 403 is enforced by the global `AuthGuard`
 * (`validateTenantScope`, already covered generically by
 * `auth.guard.spec.ts`) — boots the REAL `AuthGuard` behind this
 * controller (not a stub) to prove the route does not bypass it.
 */
import { IS_PUBLIC_KEY } from "../../src/decorators/public.decorator";
import { ServiceExceptionFilter } from "../../src/filters/service-exception.filter";
import { AuthGuard } from "../../src/guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import type { JwtService } from "../../src/modules/auth/jwt.service";
import type { PublicRoutesCacheService } from "../../src/modules/auth/public-routes-cache.service";
import { ConnectorInvokeController } from "../../src/modules/connector-invoke/connector-invoke.controller";
import { ConnectorInvokeProxyService } from "../../src/modules/connector-invoke/connector-invoke-proxy.service";

describe("ConnectorInvokeController — no @Public() decorator", () => {
  it("does not carry IS_PUBLIC_KEY metadata on the invoke handler or class", () => {
    const reflector = new Reflector();
    const handlerMeta = reflector.get(
      IS_PUBLIC_KEY,
      ConnectorInvokeController.prototype.invoke
    );
    const classMeta = reflector.get(IS_PUBLIC_KEY, ConnectorInvokeController);
    expect(handlerMeta).toBeUndefined();
    expect(classMeta).toBeUndefined();
  });
});

describe("ConnectorInvokeController — HTTP contract (payload + status mapping)", () => {
  let app: NestFastifyApplication;
  const proxy = mock(() => Promise.resolve({ invocationId: "inv-1" }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectorInvokeController],
      providers: [
        { provide: ConnectorInvokeProxyService, useValue: { proxy } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter()
    );
    app.setGlobalPrefix("api", { exclude: [] });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: ["1", VERSION_NEUTRAL],
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());
  afterEach(() => proxy.mockClear());

  it("forwards connectorId/endpointId (percent-encoded) and the body verbatim", async () => {
    const body = { args: { a: 1, nested: { b: "c" } }, mode: "sync" };
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connectors/conn-1/endpoints/ep-1/invoke",
      headers: { [REQUEST_TENANT_KEY]: "acme" },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/invoke/conn-1/ep-1",
        body,
      })
    );
  });

  it("returns 200 with the facade body on success", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connectors/conn-1/endpoints/ep-1/invoke",
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ invocationId: "inv-1" });
  });

  const statusCases: Array<[number, Record<string, unknown>]> = [
    [400, { error: "invalid args" }],
    [429, { error: "rate_limited", message: "too many", resetSeconds: 5 }],
    [502, { error: "http_error", message: "upstream failed" }],
    [503, { error: "breaker_open", retryAfterMs: 1500 }],
    [504, { error: "timeout" }],
  ];

  for (const [status, body] of statusCases) {
    it(`surfaces downstream status ${status} with its body unmodified`, async () => {
      const { HttpException } = await import("@nestjs/common");
      proxy.mockImplementationOnce(() =>
        Promise.reject(new HttpException(body, status))
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/connectors/conn-1/endpoints/ep-1/invoke",
        payload: { args: {} },
      });

      expect(res.statusCode).toBe(status);
      expect(JSON.parse(res.payload)).toMatchObject(body);
    });
  }
});

describe("ConnectorInvokeController — real AuthGuard cross-tenant 403", () => {
  let app: NestFastifyApplication;
  const proxy = mock(() => Promise.resolve({ invocationId: "inv-1" }));
  let jwtService: JwtService;
  let publicRoutesCache: PublicRoutesCacheService;

  beforeAll(async () => {
    jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "user-1",
          type: "user",
          scope: "tenant:other-tenant",
          env: "dev",
          iat: 1,
          exp: 2,
        })
      ),
    } as unknown as JwtService;
    publicRoutesCache = {
      getPublicRoutes: mock(() => Promise.resolve([])),
      isMatch: mock(() => false),
    } as unknown as PublicRoutesCacheService;

    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectorInvokeController],
      providers: [
        { provide: ConnectorInvokeProxyService, useValue: { proxy } },
        { provide: "JwtService", useValue: jwtService },
        Reflector,
        {
          provide: AuthGuard,
          useFactory: (reflector: Reflector) =>
            new AuthGuard(reflector, jwtService, publicRoutesCache),
          inject: [Reflector],
        },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_FILTER, useClass: ServiceExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter()
    );
    // Simulates TenantGuard's job (resolved tenant on the request) without
    // pulling in the full TenantGuard/Redis dependency chain — AuthGuard is
    // the guard under test here.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook(
        "onRequest",
        (req: { [k: string]: unknown }, _reply: unknown, done: () => void) => {
          req[REQUEST_TENANT_KEY] = "acme";
          done();
        }
      );
    app.setGlobalPrefix("api", { exclude: [] });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: ["1", VERSION_NEUTRAL],
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it("rejects a tenant-scoped caller whose token tenant does not match the request tenant (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/connectors/conn-1/endpoints/ep-1/invoke",
      headers: { authorization: "Bearer valid.jwt" },
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });
});
