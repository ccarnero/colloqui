import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { ValidationPipe } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "@yoizen/observability";
import { RuntimeController } from "../../src/modules/runtime/runtime.controller";
import { RuntimeProxyService } from "../../src/modules/runtime/runtime-proxy.service";

/**
 * Regression test for the T03 blocker of
 * manual-loops/agents/long-running-agent-executions.md (human amendment
 * 2026-07-30): `POST /runtime/executions` used to 400 with
 * `"property metadata should not exist"`, because `CreateExecutionDto` did
 * not declare `metadata` and the global ValidationPipe runs with
 * `whitelist` + `forbidNonWhitelisted` (see
 * `packages/observability/src/bootstrap-fastify.ts`). That made the
 * dev-only delay hook's `metadata.__test_delay_ms` key unreachable from the
 * async submit path this gateway fronts.
 *
 * The pipe config below is copied verbatim from the shared bootstrap (same
 * pattern as `gateway-validation-pipe.http.spec.ts`), so the assertion is
 * about the REAL request path, not a hand-rolled validation.
 */

async function bootApp(): Promise<{
  app: NestFastifyApplication;
  proxy: ReturnType<typeof mock>;
}> {
  const proxy = mock(() =>
    Promise.resolve({ executionId: "exec-1", status: "accepted" })
  );
  const moduleRef = await Test.createTestingModule({
    controllers: [RuntimeController],
    providers: [{ provide: RuntimeProxyService, useValue: { proxy } }],
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
  return { app, proxy };
}

describe("RuntimeController POST /runtime/executions — metadata pass-through", () => {
  let app: NestFastifyApplication;
  let proxy: ReturnType<typeof mock>;

  beforeAll(async () => {
    ({ app, proxy } = await bootApp());
  });
  afterAll(async () => app.close());

  it("accepts a body carrying `metadata` and forwards it verbatim to the proxy (202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
        metadata: { __test_delay_ms: 120000, note: "e2e" },
      },
    });

    expect(res.statusCode).toBe(202);
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/runtime/executions",
        body: expect.objectContaining({
          agentId: "11111111-1111-4111-8111-111111111111",
          message: "hi",
          metadata: { __test_delay_ms: 120000, note: "e2e" },
        }),
      })
    );
  });

  it("still accepts a body WITHOUT metadata (the field is optional)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
      },
    });

    expect(res.statusCode).toBe(202);
  });

  it("still rejects a non-object metadata and any undeclared property", async () => {
    const nonObject = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
        metadata: "not-an-object",
      },
    });
    expect(nonObject.statusCode).toBe(400);

    const undeclared = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
        totallyUnknownField: 1,
      },
    });
    expect(undeclared.statusCode).toBe(400);
  });
});
