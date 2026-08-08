import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { ValidationPipe } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "@yoizen/observability";
import { AdminAgentsController } from "../../src/modules/admin/admin-agents.controller";
import { AdminJobsController } from "../../src/modules/admin/admin-jobs.controller";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";
import { AdminStructuredKBController } from "../../src/modules/admin/admin-structured-kb.controller";
import { WorkflowProxyService } from "../../src/modules/workflows/workflow-proxy.service";
import { WorkflowsController } from "../../src/modules/workflows/workflows.controller";

/**
 * Regression test for a real production incident: proxied routes whose
 * `@Body()`/`@Query()` DTO class was imported via `import type` compiled
 * (via `tsc`, the same toolchain the Docker build uses — see
 * `services/api-gateway/Dockerfile`) to a `design:paramtypes` entry of the
 * generic `Function` global instead of the real DTO class, because the
 * class binding didn't exist at runtime after type-only-import erasure.
 *
 * `ValidationPipe.toValidate()` does NOT skip `Function` (its skip-list is
 * `[String, Boolean, Number, Array, Object, Buffer, Date]`), so the pipe
 * proceeded to `plainToInstance(Function, body)` (i.e. `new Function()`)
 * and validated the result against class-validator metadata registered on
 * `Function` — which is always empty — so every real field got rejected
 * with `"property X should not exist"` even though the actual DTO class
 * declares it correctly.
 *
 * This suite boots the real controllers behind the *exact* global
 * `ValidationPipe` config from `src/main.ts` and posts the known-real
 * bodies documented for each route. It only catches shape/decoration
 * regressions when run against `tsc`-compiled output (bun's own
 * transpiler does not reproduce the `import type` erasure), so it is
 * paired with `dto-import-metatype.spec.ts`, which statically asserts
 * these imports stay value imports.
 */

async function bootApp(
  controllers: Function[],
  providers: { provide: unknown; useValue: unknown }[]
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers,
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter()
  );
  // THE production options, imported — not copied — from
  // `@yoizen/observability` (register 11, T01/T02): a copied object is a test
  // that validates a pipe the gateway does not actually run.
  app.useGlobalPipes(new ValidationPipe(PRODUCTION_VALIDATION_PIPE_OPTIONS));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("gateway ValidationPipe — real DTO bodies on proxied routes", () => {
  describe("workflows execute", () => {
    let app: NestFastifyApplication;
    const proxy = mock(() => Promise.resolve({ ok: true }));

    beforeAll(async () => {
      app = await bootApp(
        [WorkflowsController],
        [{ provide: WorkflowProxyService, useValue: { proxy } }]
      );
    });
    afterAll(async () => app.close());

    it("accepts { request, agentTimeoutSec } — does not 400 with 'property request should not exist'", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/workflows/wf-1/execute",
        payload: { request: { text: "hi" }, agentTimeoutSec: 30 },
      });
      expect(res.statusCode).toBe(202);
      expect(proxy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ request: { text: "hi" } }),
        })
      );
    });
  });

  describe("admin agents create", () => {
    let app: NestFastifyApplication;
    const proxy = mock(() => Promise.resolve({ id: "agent-1" }));

    beforeAll(async () => {
      app = await bootApp(
        [AdminAgentsController],
        [{ provide: AdminProxyService, useValue: { proxy } }]
      );
    });
    afterAll(async () => app.close());

    it("accepts { name, system_prompt } — does not 400 with 'property system_prompt should not exist'", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/agents",
        payload: { name: "probe", system_prompt: "hello" },
      });
      expect(res.statusCode).toBe(201);
      expect(proxy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            name: "probe",
            system_prompt: "hello",
          }),
        })
      );
    });
  });

  describe("admin jobs create", () => {
    let app: NestFastifyApplication;
    const proxy = mock(() => Promise.resolve({ id: "job-1" }));

    beforeAll(async () => {
      app = await bootApp(
        [AdminJobsController],
        [{ provide: AdminProxyService, useValue: { proxy } }]
      );
    });
    afterAll(async () => app.close());

    it("accepts { name, agent_id, schedule, is_active } — does not 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/jobs",
        payload: {
          name: "job",
          agent_id: "11111111-1111-1111-1111-111111111111",
          schedule: "0 0 * * *",
          is_active: false,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(proxy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ name: "job", is_active: false }),
        })
      );
    });
  });

  describe("admin structured-kb query", () => {
    let app: NestFastifyApplication;
    const proxy = mock(() => Promise.resolve({ items: [] }));

    beforeAll(async () => {
      app = await bootApp(
        [AdminStructuredKBController],
        [{ provide: AdminProxyService, useValue: { proxy } }]
      );
    });
    afterAll(async () => app.close());

    it("accepts a real query body without 400ing on its declared fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/structured-kb/containers/kb-1/query",
        payload: { query: "hello", limit: 5 },
      });
      expect(res.statusCode).not.toBe(400);
    });
  });
});
