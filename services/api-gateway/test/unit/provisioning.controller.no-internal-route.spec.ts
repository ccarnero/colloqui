import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ProvisioningController } from "../../src/modules/provisioning/provisioning.controller";
import { ProvisioningProxyService } from "../../src/modules/provisioning/provisioning-proxy.service";

/**
 * Regression test for T07 of manual-loops/declarative-provisioning.md's hard
 * rule: `POST /internal/secrets/resolve` (the secrets broker,
 * `services/provisioning-service/src/modules/secrets/broker/
 * secrets-broker.controller.ts`) is NEVER exposed through the gateway. No
 * `ProvisioningController` handler maps to an `/internal/*` downstream path
 * (verified structurally in `provisioning.controller.spec.ts`'s call-site
 * assertions); this test additionally proves that at the HTTP layer no
 * `/api/v1/provisioning/internal/*` route resolves — Nest returns 404 and
 * the downstream proxy is never invoked, so the internal-only route cannot
 * be reached even by guessing the gateway path.
 */
describe("ProvisioningController — broker internal route is absent from the gateway", () => {
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

  const internalPaths = [
    "/api/v1/provisioning/internal/secrets/resolve",
    "/api/provisioning/internal/secrets/resolve",
    "/api/v1/provisioning/internal/secrets",
    "/api/v1/internal/secrets/resolve",
  ];

  for (const path of internalPaths) {
    it(`POST ${path} resolves to 404 (no gateway route mapping) and never reaches the proxy`, async () => {
      const res = await app.inject({
        method: "POST",
        url: path,
        payload: {
          consumerService: "agent-ai-service",
          secretName: "hubspot-api-key",
          actingResource: { kind: "connector", owner: "hubspot" },
          correlationId: "corr-1",
        },
      });
      expect(res.statusCode).toBe(404);
    });
  }

  it("never calls the downstream proxy for any internal path attempt", () => {
    expect(proxy).not.toHaveBeenCalled();
    expect(proxyWithStatus).not.toHaveBeenCalled();
  });
});
