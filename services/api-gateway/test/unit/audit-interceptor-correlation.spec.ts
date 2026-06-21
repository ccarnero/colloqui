import { describe, it, expect, mock, beforeEach } from "bun:test";
import { of } from "rxjs";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { JetStreamClient } from "nats";
import { AuditInterceptor } from "../../src/interceptors/audit.interceptor";
import type { IYoizenRequest } from "../../src/types/yoizen-request";

describe("AuditInterceptor — correlation propagation", () => {
  let publishMock: ReturnType<typeof mock>;
  let js: JetStreamClient;

  beforeEach(() => {
    publishMock = mock(() => Promise.resolve());
    js = { publish: publishMock } as unknown as JetStreamClient;
  });

  function createInterceptor(): AuditInterceptor {
    return new AuditInterceptor(js);
  }

  function createExecution(
    request: IYoizenRequest,
    reply: FastifyReply,
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

  it("includes correlationId/causationId/depth when request has stamps", async () => {
    const interceptor = createInterceptor();
    const req = {
      method: "POST",
      url: "/api/webhooks/whatsapp/t1",
      headers: { "user-agent": "webhook-provider" },
      id: "req-wh-1",
      ip: "1.2.3.4",
      __correlationId: "corr-wh-uuid",
      __causationId: null,
      __depth: 0,
    } as IYoizenRequest;
    const reply = baseReply();
    const next: CallHandler = { handle: () => of({ status: "accepted" }) };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createExecution(req, reply), next).subscribe({
        complete: resolve,
        error: reject,
      });
    });

    expect(publishMock).toHaveBeenCalled();
    const [, payload] = publishMock.mock.calls[0] as [string, Uint8Array];
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<
      string,
      unknown
    >;
    expect(parsed.correlationId).toBe("corr-wh-uuid");
    expect(parsed.causationId).toBeNull();
    expect(parsed.depth).toBe(0);
  });

  it("sets correlationId/causationId/depth to null for non-webhook requests (no fabrication)", async () => {
    const interceptor = createInterceptor();
    const req = {
      method: "GET",
      url: "/audit/events",
      headers: { "user-agent": "test-ua" },
      id: "req-platform-1",
      ip: "10.0.0.1",
      // No __correlationId, __causationId, or __depth stamps
    } as IYoizenRequest;
    const reply = baseReply();
    const next: CallHandler = { handle: () => of({ items: [] }) };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createExecution(req, reply), next).subscribe({
        complete: resolve,
        error: reject,
      });
    });

    expect(publishMock).toHaveBeenCalled();
    const [, payload] = publishMock.mock.calls[0] as [string, Uint8Array];
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<
      string,
      unknown
    >;
    expect(parsed.correlationId).toBeNull();
    expect(parsed.causationId).toBeNull();
    expect(parsed.depth).toBeNull();
  });
});
