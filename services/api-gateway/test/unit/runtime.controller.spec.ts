import { describe, expect, it, mock } from "bun:test";
import type { FastifyReply } from "fastify";
import { RuntimeController } from "../../src/modules/runtime/runtime.controller";
import type { CreateExecutionDto } from "../../src/modules/runtime/runtime.dto";
import type { RuntimeProxyService } from "../../src/modules/runtime/runtime-proxy.service";
import type { ITenantScopedRequest } from "../../src/types/yoizen-request";

describe("RuntimeController.streamExecution (DOCS/architecture/runtime-streaming.md §3.4)", () => {
  function makeReq(
    overrides: Partial<ITenantScopedRequest> = {}
  ): ITenantScopedRequest {
    return {
      tenantId: "acme",
      user: { sub: "user-1" },
      ...overrides,
    } as ITenantScopedRequest;
  }

  it("delegates to proxy.proxyStream with the raw Fastify reply, tenant, body, and trusted user", async () => {
    const proxyStreamSpy = mock(() => Promise.resolve());
    const controller = new RuntimeController({
      proxyStream: proxyStreamSpy,
    } as unknown as RuntimeProxyService);

    const reply = {} as FastifyReply;
    const body: CreateExecutionDto = {
      agentId: "11111111-1111-1111-1111-111111111111",
      message: "hi",
    } as CreateExecutionDto;

    await controller.streamExecution(makeReq(), reply, body);

    expect(proxyStreamSpy).toHaveBeenCalledTimes(1);
    const [passedReply, options] = proxyStreamSpy.mock.calls[0] as [
      FastifyReply,
      { tenantId: string; body: unknown; trustedUserId?: string },
    ];
    expect(passedReply).toBe(reply);
    expect(options.tenantId).toBe("acme");
    expect(options.body).toBe(body);
    expect(options.trustedUserId).toBe("user-1");
  });

  it("does not set trustedUserId when the request has no authenticated user", async () => {
    const proxyStreamSpy = mock(() => Promise.resolve());
    const controller = new RuntimeController({
      proxyStream: proxyStreamSpy,
    } as unknown as RuntimeProxyService);

    const reply = {} as FastifyReply;
    const body = {} as CreateExecutionDto;

    await controller.streamExecution(makeReq({ user: undefined }), reply, body);

    const [, options] = proxyStreamSpy.mock.calls[0] as [
      unknown,
      { trustedUserId?: string },
    ];
    expect(options.trustedUserId).toBeUndefined();
  });
});
