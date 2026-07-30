import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { ValidationPipe } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ExecutionsController } from "../../src/modules/executions/executions.controller";
import { ExecutionsService } from "../../src/modules/executions/executions.service";

/**
 * Regression test for the T03 blocker of
 * manual-loops/agents/long-running-agent-executions.md (human amendment
 * 2026-07-30): `POST /runtime/executions` used to 400 with
 * `"property metadata should not exist"` because `CreateExecutionDto` did
 * not declare `metadata`, while the shared bootstrap installs a global
 * ValidationPipe with `whitelist` + `forbidNonWhitelisted`
 * (`packages/observability/src/bootstrap-fastify.ts`). That made the
 * dev-only delay hook's `metadata.__test_delay_ms` fallback key
 * (`services/agent-ai-service/src/nats-handlers/test-delay.ts`, which reads
 * it back off `input.metadata` of the published `execution_requested`)
 * unreachable from the async submit path.
 *
 * The pipe below is configured exactly like the shared bootstrap, so this
 * exercises the real request path — DTO shape AND pipe config together.
 */

const submitExecution = mock(() =>
  Promise.resolve({ executionId: "exec-1", status: "accepted" })
);

async function bootApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ExecutionsController],
    providers: [{ provide: ExecutionsService, useValue: { submitExecution } }],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter()
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("ExecutionsController POST /runtime/executions — metadata pass-through", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => app.close());

  it("accepts `metadata` and hands it verbatim to submitExecution (202)", async () => {
    submitExecution.mockClear();
    const res = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      headers: { "x-yoizen-tenant": "acme" },
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
        metadata: { __test_delay_ms: 120000 },
      },
    });

    expect(res.statusCode).toBe(202);
    expect(submitExecution).toHaveBeenCalledTimes(1);
    const [tenantId, input] = submitExecution.mock.calls[0] as unknown as [
      string,
      { metadata?: Record<string, unknown> },
    ];
    expect(tenantId).toBe("acme");
    expect(input.metadata).toEqual({ __test_delay_ms: 120000 });
  });

  it("still accepts a body WITHOUT metadata (the field is optional)", async () => {
    submitExecution.mockClear();
    const res = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      headers: { "x-yoizen-tenant": "acme" },
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
      },
    });

    expect(res.statusCode).toBe(202);
    const [, input] = submitExecution.mock.calls[0] as unknown as [
      string,
      { metadata?: Record<string, unknown> },
    ];
    expect(input.metadata).toBeUndefined();
  });

  it("still rejects a non-object metadata and any undeclared property", async () => {
    const nonObject = await app.inject({
      method: "POST",
      url: "/runtime/executions",
      headers: { "x-yoizen-tenant": "acme" },
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
      headers: { "x-yoizen-tenant": "acme" },
      payload: {
        agentId: "11111111-1111-4111-8111-111111111111",
        message: "hi",
        totallyUnknownField: 1,
      },
    });
    expect(undeclared.statusCode).toBe(400);
  });
});
