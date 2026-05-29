import { describe, it, expect, mock, beforeEach } from "bun:test";
import { of } from "rxjs";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { JetStreamClient } from "nats";
import { GATEWAY_AUDIT_SUBJECT, TENANT_HEADER } from "@yoizen/shared";
import type { JwtPayload } from "@yoizen/shared";
import { AuditInterceptor } from "../../src/interceptors/audit.interceptor";
import { REQUEST_USER_KEY } from "../../src/guards/auth.guard";
import { REQUEST_TENANT_KEY } from "../../src/guards/tenant.guard";
import type { IYoizenRequest } from "../../src/types/yoizen-request";

describe("AuditInterceptor", () => {
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

  it("passes through without publishing for /health", async () => {
    const interceptor = createInterceptor();
    const req = {
      method: "GET",
      url: "/health",
      headers: {},
      id: "req-1",
      ip: "127.0.0.1",
    } as IYoizenRequest;
    const reply = baseReply();
    const next: CallHandler = {
      handle: () => of({ ok: true }),
    };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createExecution(req, reply), next).subscribe({
        complete: resolve,
        error: reject,
      });
    });

    expect(publishMock).not.toHaveBeenCalled();
  });

  it("publishes gateway audit event on successful responses", async () => {
    const interceptor = createInterceptor();
    const user: JwtPayload = {
      sub: "sub-99",
      type: "user",
      scope: "tenant:t1",
      env: "dev",
      iat: 1,
      exp: 2,
    };
    const req = {
      method: "POST",
      url: "/events?x=1",
      headers: { "user-agent": "test-ua" },
      id: "req-2",
      ip: "10.0.0.1",
      [REQUEST_USER_KEY]: user,
      [REQUEST_TENANT_KEY]: "t1",
    } as IYoizenRequest;
    const reply = baseReply();
    const next: CallHandler = {
      handle: () => of({ accepted: true }),
    };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createExecution(req, reply), next).subscribe({
        complete: resolve,
        error: reject,
      });
    });

    expect(publishMock).toHaveBeenCalled();
    const [subject, payload] = publishMock.mock.calls[0] as [
      string,
      Uint8Array,
    ];
    expect(subject).toBe(GATEWAY_AUDIT_SUBJECT);
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<
      string,
      unknown
    >;
    expect(parsed.method).toBe("POST");
    expect(parsed.path).toBe("/events");
    expect(parsed.jwtSubject).toBe("sub-99");
    expect(parsed.tenantId).toBe("t1");
    expect(parsed.error).toBeUndefined();
    const thirdArg = publishMock.mock.calls[0][2] as
      | { headers?: { get: (k: string) => string | undefined } }
      | undefined;
    expect(thirdArg?.headers?.get(TENANT_HEADER)).toBe("t1");
  });

  it("skips audit for webhook paths when GATEWAY_AUDIT_SKIP_WEBHOOKS=true", async () => {
    const prev = process.env.GATEWAY_AUDIT_SKIP_WEBHOOKS;
    process.env.GATEWAY_AUDIT_SKIP_WEBHOOKS = "true";
    try {
      const interceptor = createInterceptor();
      const req = {
        method: "POST",
        url: "/api/webhooks/telegram/acme",
        headers: {},
        id: "req-wh",
        ip: "127.0.0.1",
      } as IYoizenRequest;
      const reply = baseReply();
      const next: CallHandler = {
        handle: () => of({ ok: true }),
      };

      await new Promise<void>((resolve, reject) => {
        interceptor.intercept(createExecution(req, reply), next).subscribe({
          complete: resolve,
          error: reject,
        });
      });

      expect(publishMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.GATEWAY_AUDIT_SKIP_WEBHOOKS;
      } else {
        process.env.GATEWAY_AUDIT_SKIP_WEBHOOKS = prev;
      }
    }
  });
});
