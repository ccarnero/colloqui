// T04 of manual-loops/payload-capture.md: proves a successful payload fetch
// is audited through the EXISTING audit-ingestion path — the global
// `AuditInterceptor` (APP_INTERCEPTOR in AppModule) + `publishGatewayAuditEvent`
// — with the causal-chain `correlationId` the controller stamps onto the
// request (mirroring WebhookIngressPublisherService's precedent). No new
// event schema or publish helper is introduced; this spies on the SAME
// publisher `gateway-audit-publish.util.ts` already uses.
import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { GatewayAuditEvent } from "@yoizen/shared";
import type { FastifyReply } from "fastify";
import type { JetStreamClient } from "nats";
import { of } from "rxjs";
import { REQUEST_USER_KEY } from "../../src/guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import { AuditInterceptor } from "../../src/interceptors/audit.interceptor";
import { TrackingController } from "../../src/modules/tracking/tracking.controller";
import type { TrackingProxyService } from "../../src/modules/tracking/tracking-proxy.service";
import type { IYoizenRequest } from "../../src/types/yoizen-request";

describe("tracking payload fetch — audit event via the existing audit-ingestion path", () => {
  let publishMock: ReturnType<typeof mock>;
  let js: JetStreamClient;

  beforeEach(() => {
    publishMock = mock(() => Promise.resolve());
    js = { publish: publishMock } as unknown as JetStreamClient;
  });

  function createExecution(
    request: IYoizenRequest,
    reply: FastifyReply
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => reply,
      }),
    } as unknown as ExecutionContext;
  }

  function baseReply(): FastifyReply {
    return {
      statusCode: 200,
      getHeader: mock(() => undefined),
    } as unknown as FastifyReply;
  }

  it("publishes a gateway audit event carrying actor, tenant, correlation_id, and timestamp for a successful payload fetch (event_id travels in the audited path)", async () => {
    const proxy = mock(() =>
      Promise.resolve({ payload: { foo: "bar" }, payload_status: "inline" })
    );
    const controller = new TrackingController({
      proxy,
    } as unknown as TrackingProxyService);

    const req = {
      method: "GET",
      url: "/tracking/chains/corr-1/events/evt-1/payload",
      headers: { "user-agent": "test-ua" },
      id: "req-1",
      ip: "10.0.0.1",
      [REQUEST_TENANT_KEY]: "acme",
      [REQUEST_USER_KEY]: { sub: "user-admin-1" },
    } as unknown as IYoizenRequest;

    // Exercise the actual controller handler — this is what stamps
    // req.__correlationId before the interceptor's response tap runs.
    const body = await controller.getPayload(req as never, "corr-1", "evt-1");
    expect(body).toEqual({ payload: { foo: "bar" }, payload_status: "inline" });

    const interceptor = new AuditInterceptor(js);
    const reply = baseReply();
    const next: CallHandler = { handle: () => of(body) };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createExecution(req, reply), next).subscribe({
        complete: resolve,
        error: reject,
      });
    });

    expect(publishMock).toHaveBeenCalledTimes(1);
    const [, payload] = publishMock.mock.calls[0] as [string, Uint8Array];
    const event = JSON.parse(
      new TextDecoder().decode(payload)
    ) as GatewayAuditEvent;

    expect(event.jwtSubject).toBe("user-admin-1"); // actor
    expect(event.tenantId).toBe("acme"); // tenant
    expect(event.correlationId).toBe("corr-1"); // correlation_id
    expect(event.path).toBe("/tracking/chains/corr-1/events/evt-1/payload"); // carries event_id
    expect(typeof event.timestamp).toBe("string");
    expect(event.statusCode).toBe(200);
  });
});
