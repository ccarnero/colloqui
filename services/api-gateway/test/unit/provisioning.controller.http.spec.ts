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
import { HttpException, VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
/**
 * Contract tests for T07 of manual-loops/declarative-provisioning.md:
 * `/api/v1/provisioning/*` gateway proxy routes.
 *
 * - No `@Public()` decorator on any handler (repo convention, same as
 *   `connector-invoke.controller.http.spec.ts`).
 * - Downstream status passthrough for plan/apply (404/409).
 * - Route scopes: manifests routes accept ANY tenant-scoped JWT
 *   (tenant-operator level); `PUT /provisioning/secrets/:name` requires the
 *   `secrets:write` permission (or `tenant_admin`'s wildcard
 *   `permissions: ["*"]`) — real `AuthGuard`, not a stub, same pattern as
 *   `tracking-payload-guard.spec.ts`.
 */
import { IS_PUBLIC_KEY } from "../../src/decorators/public.decorator";
import { ServiceExceptionFilter } from "../../src/filters/service-exception.filter";
import { AuthGuard } from "../../src/guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import type { JwtService } from "../../src/modules/auth/jwt.service";
import type { PublicRoutesCacheService } from "../../src/modules/auth/public-routes-cache.service";
import { ProvisioningController } from "../../src/modules/provisioning/provisioning.controller";
import { ProvisioningProxyService } from "../../src/modules/provisioning/provisioning-proxy.service";

const HANDLER_NAMES = [
  "validate",
  "putManifest",
  "getManifest",
  "plan",
  "apply",
  "putSecret",
  "listSecrets",
] as const;

describe("ProvisioningController — no @Public() decorator", () => {
  it("does not carry IS_PUBLIC_KEY metadata on any handler or the class", () => {
    const reflector = new Reflector();
    const classMeta = reflector.get(IS_PUBLIC_KEY, ProvisioningController);
    expect(classMeta).toBeUndefined();
    for (const name of HANDLER_NAMES) {
      const handlerMeta = reflector.get(
        IS_PUBLIC_KEY,
        (ProvisioningController.prototype as Record<string, unknown>)[name]
      );
      expect(handlerMeta).toBeUndefined();
    }
  });
});

describe("ProvisioningController — HTTP contract (payload + status passthrough)", () => {
  let app: NestFastifyApplication;
  const proxy = mock(() => Promise.resolve({ ok: true }));
  const proxyWithStatus = mock(() =>
    Promise.resolve({ status: 200, body: { ok: true } })
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProvisioningController],
      providers: [
        {
          provide: ProvisioningProxyService,
          useValue: { proxy, proxyWithStatus },
        },
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
  afterEach(() => {
    proxy.mockClear();
    proxyWithStatus.mockClear();
  });

  it("POST manifests/validate forwards the body verbatim", async () => {
    const body = { spec: { channels: [] } };
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provisioning/manifests/validate",
      headers: { [REQUEST_TENANT_KEY]: "acme" },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/manifests/validate",
        body,
      })
    );
  });

  it("PUT manifests/:name forwards the encoded name and body", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/provisioning/manifests/acme-support",
      payload: { spec: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/manifests/acme-support",
      })
    );
  });

  it("GET manifests/:name forwards no body", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/provisioning/manifests/acme-support",
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/manifests/acme-support",
      })
    );
  });

  it("POST manifests/:name/plan returns 200 with downstream body on success", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provisioning/manifests/acme-support/plan",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
  });

  it("POST manifests/:name/plan surfaces a 409 cycle_detected unmodified", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: 409,
        body: { error: { kind: "cycle_detected" } },
      })
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provisioning/manifests/acme-support/plan",
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload)).toEqual({
      error: { kind: "cycle_detected" },
    });
  });

  it("POST manifests/:name/plan surfaces a thrown 404 manifest_not_found unmodified", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.reject(new HttpException("No manifest named 'x' found", 404))
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provisioning/manifests/x/plan",
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST manifests/:name/apply forwards the bundle body and returns 200", async () => {
    const body = { bundle: { contentBase64: "abc123" } };
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provisioning/manifests/acme-support/apply",
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(proxyWithStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/manifests/acme-support/apply",
        body,
      })
    );
  });

  it("POST manifests/:name/apply surfaces a 409 partial-failure unmodified", async () => {
    proxyWithStatus.mockImplementationOnce(() =>
      Promise.resolve({
        status: 409,
        body: {
          error: { kind: "partial_failure", applied: ["a"], pending: ["b"] },
        },
      })
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/provisioning/manifests/acme-support/apply",
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it("PUT secrets/:name forwards the value body verbatim to the downstream proxy", async () => {
    const body = {
      value: "s3cr3t",
      scope: { kind: "connector", owner: "hubspot" },
    };
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/provisioning/secrets/hubspot-api-key",
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/secrets/hubspot-api-key",
        body,
      })
    );
  });

  it("GET secrets lists names+bindings with no body", async () => {
    proxy.mockImplementationOnce(() =>
      Promise.resolve({
        secrets: [
          {
            name: "hubspot-api-key",
            scope: { kind: "connector", owner: "hubspot" },
          },
        ],
      })
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/provisioning/secrets",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      secrets: [
        {
          name: "hubspot-api-key",
          scope: { kind: "connector", owner: "hubspot" },
        },
      ],
    });
  });
});

describe("ProvisioningController — real AuthGuard scope enforcement", () => {
  let app: NestFastifyApplication;
  const proxy = mock(() => Promise.resolve({ ok: true }));
  const proxyWithStatus = mock(() =>
    Promise.resolve({ status: 200, body: { ok: true } })
  );
  let publicRoutesCache: PublicRoutesCacheService;

  function buildApp(jwtService: JwtService): Promise<NestFastifyApplication> {
    return Test.createTestingModule({
      controllers: [ProvisioningController],
      providers: [
        {
          provide: ProvisioningProxyService,
          useValue: { proxy, proxyWithStatus },
        },
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
    })
      .compile()
      .then(async (moduleRef) => {
        const builtApp =
          moduleRef.createNestApplication<NestFastifyApplication>(
            new FastifyAdapter()
          );
        builtApp
          .getHttpAdapter()
          .getInstance()
          .addHook(
            "onRequest",
            (
              req: { [k: string]: unknown },
              _reply: unknown,
              done: () => void
            ) => {
              req[REQUEST_TENANT_KEY] = "acme";
              done();
            }
          );
        builtApp.setGlobalPrefix("api", { exclude: [] });
        builtApp.enableVersioning({
          type: VersioningType.URI,
          defaultVersion: ["1", VERSION_NEUTRAL],
        });
        await builtApp.init();
        await builtApp.getHttpAdapter().getInstance().ready();
        return builtApp;
      });
  }

  beforeAll(() => {
    publicRoutesCache = {
      getPublicRoutes: mock(() => Promise.resolve([])),
      isMatch: mock(() => false),
    } as unknown as PublicRoutesCacheService;
  });

  afterEach(async () => {
    proxy.mockClear();
    proxyWithStatus.mockClear();
    if (app) {
      await app.close();
    }
  });

  it("allows a bare tenant-scoped caller (operator level, no permissions) on manifests routes", async () => {
    const jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "u1",
          type: "user",
          scope: "tenant:acme",
          env: "dev",
          iat: 1,
          exp: 2,
          permissions: [],
        })
      ),
    } as unknown as JwtService;
    app = await buildApp(jwtService);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/provisioning/manifests/acme-support",
      headers: { authorization: "Bearer valid.jwt" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a tenant-scoped caller with no permissions on PUT secrets (needs secrets:write)", async () => {
    const jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "u1",
          type: "user",
          scope: "tenant:acme",
          env: "dev",
          iat: 1,
          exp: 2,
          permissions: [],
        })
      ),
    } as unknown as JwtService;
    app = await buildApp(jwtService);

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/provisioning/secrets/hubspot-api-key",
      headers: { authorization: "Bearer valid.jwt" },
      payload: {
        value: "s3cr3t",
        scope: { kind: "connector", owner: "hubspot" },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });

  it("allows a tenant_admin caller (wildcard permissions) on PUT secrets", async () => {
    const jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "admin-1",
          type: "user",
          scope: "tenant:acme",
          env: "dev",
          iat: 1,
          exp: 2,
          permissions: ["*"],
        })
      ),
    } as unknown as JwtService;
    app = await buildApp(jwtService);

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/provisioning/secrets/hubspot-api-key",
      headers: { authorization: "Bearer valid.jwt" },
      payload: {
        value: "s3cr3t",
        scope: { kind: "connector", owner: "hubspot" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalled();
  });

  it("allows a caller with the exact secrets:write permission on PUT secrets", async () => {
    const jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "u2",
          type: "user",
          scope: "tenant:acme",
          env: "dev",
          iat: 1,
          exp: 2,
          permissions: ["secrets:write"],
        })
      ),
    } as unknown as JwtService;
    app = await buildApp(jwtService);

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/provisioning/secrets/hubspot-api-key",
      headers: { authorization: "Bearer valid.jwt" },
      payload: {
        value: "s3cr3t",
        scope: { kind: "connector", owner: "hubspot" },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("allows a bare tenant-scoped caller (operator level) on GET secrets (list is names+bindings only)", async () => {
    const jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "u1",
          type: "user",
          scope: "tenant:acme",
          env: "dev",
          iat: 1,
          exp: 2,
          permissions: [],
        })
      ),
    } as unknown as JwtService;
    app = await buildApp(jwtService);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/provisioning/secrets",
      headers: { authorization: "Bearer valid.jwt" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a cross-tenant caller (token tenant does not match request tenant) with 403", async () => {
    const jwtService = {
      verify: mock(() =>
        Promise.resolve({
          sub: "u1",
          type: "user",
          scope: "tenant:other-tenant",
          env: "dev",
          iat: 1,
          exp: 2,
        })
      ),
    } as unknown as JwtService;
    app = await buildApp(jwtService);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/provisioning/manifests/acme-support",
      headers: { authorization: "Bearer valid.jwt" },
    });
    expect(res.statusCode).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });
});
