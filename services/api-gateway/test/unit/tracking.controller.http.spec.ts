import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import { TrackingController } from "../../src/modules/tracking/tracking.controller";
import { TrackingProxyService } from "../../src/modules/tracking/tracking-proxy.service";

/**
 * Regression test for T02 of manual-loops/run-view.md, attempt 2: a
 * live-verification pass against the real dev cluster reported
 * `@Get("runs/:workflowId/:runId")` failing to route colon-bearing
 * Temporal workflow ids (e.g. `acme:e2e-http-agent:sha256:...:id`).
 * `tracking.controller.spec.ts` only calls the controller method directly
 * (bypassing HTTP-layer path matching entirely), so it could never have
 * caught this class of bug. This suite boots the real `TrackingController`
 * behind the *exact* global prefix + URI versioning config from
 * `src/main.ts` (`setGlobalPrefix("api")` +
 * `enableVersioning({ type: URI, defaultVersion: ["1", VERSION_NEUTRAL] })`)
 * on the real `FastifyAdapter`, and exercises the HTTP router directly via
 * `app.inject`.
 */
describe("TrackingController — HTTP-level routing (runs/:workflowId/:runId)", () => {
  let app: NestFastifyApplication;
  const proxy = mock(() => Promise.resolve({ ok: true }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [{ provide: TrackingProxyService, useValue: { proxy } }],
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

  const COMPOSITE_WORKFLOW_ID =
    "acme:e2e-http-agent:sha256:deadbeefcafe:tRUp1Qa";
  const RUN_ID = "019f54b5-abcd-7000-8000-000000000001";

  it("routes a colon-bearing workflowId at the unversioned /api/... alias", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/tracking/runs/${COMPOSITE_WORKFLOW_ID}/${RUN_ID}`,
      headers: { [REQUEST_TENANT_KEY]: "acme" },
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `/runs/${encodeURIComponent(COMPOSITE_WORKFLOW_ID)}/${RUN_ID}`,
      })
    );
  });

  it("routes a colon-bearing workflowId at the versioned /api/v1/... path", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/runs/${COMPOSITE_WORKFLOW_ID}/${RUN_ID}`,
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/runs/${encodeURIComponent(COMPOSITE_WORKFLOW_ID)}/${RUN_ID}`,
      })
    );
  });

  it("routes a percent-encoded colon-bearing workflowId identically", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/tracking/runs/${encodeURIComponent(COMPOSITE_WORKFLOW_ID)}/${RUN_ID}`,
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/runs/${encodeURIComponent(COMPOSITE_WORKFLOW_ID)}/${RUN_ID}`,
      })
    );
  });

  it("still routes a plain workflowId/runId pair (no colons)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tracking/runs/foo/bar",
    });
    expect(res.statusCode).toBe(200);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/runs/foo/bar" })
    );
  });

  it("404s when the path has more than two segments after runs/", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tracking/runs/foo/bar/extra",
    });
    expect(res.statusCode).toBe(404);
  });
});
