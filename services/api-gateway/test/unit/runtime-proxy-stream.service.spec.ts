import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { FastifyReply } from "fastify";

const pipeUpstreamSseToReplyMock = mock(() => Promise.resolve());

mock.module("../../src/utils/pipe-upstream-sse-to-reply.util", () => ({
  pipeUpstreamSseToReply: pipeUpstreamSseToReplyMock,
}));

import { RuntimeProxyService } from "../../src/modules/runtime/runtime-proxy.service";

describe("RuntimeProxyService.proxyStream (DOCS/architecture/runtime-streaming.md §3.4)", () => {
  let service: RuntimeProxyService;
  const fakeReply = {} as FastifyReply;

  beforeEach(() => {
    pipeUpstreamSseToReplyMock.mockClear();
    service = new RuntimeProxyService();
  });

  it("targets the combined /runtime/executions/stream upstream endpoint", async () => {
    await service.proxyStream(fakeReply, {
      tenantId: "acme",
      body: { agentId: "a1", message: "hi" },
    });

    expect(pipeUpstreamSseToReplyMock).toHaveBeenCalledTimes(1);
    const [reply, options] = pipeUpstreamSseToReplyMock.mock.calls[0] as [
      FastifyReply,
      { upstreamUrl: string; headers: Record<string, string>; body: unknown },
    ];
    expect(reply).toBe(fakeReply);
    expect(options.upstreamUrl).toEndWith("/runtime/executions/stream");
  });

  it("forwards the tenant header", async () => {
    await service.proxyStream(fakeReply, {
      tenantId: "acme",
      body: { agentId: "a1", message: "hi" },
    });

    const [, options] = pipeUpstreamSseToReplyMock.mock.calls[0] as [
      unknown,
      { headers: Record<string, string> },
    ];
    expect(options.headers["x-yoizen-tenant"]).toBe("acme");
  });

  it("sets the trusted-user header when trustedUserId is provided", async () => {
    await service.proxyStream(fakeReply, {
      tenantId: "acme",
      body: {},
      trustedUserId: "user-42",
    });

    const [, options] = pipeUpstreamSseToReplyMock.mock.calls[0] as [
      unknown,
      { headers: Record<string, string> },
    ];
    expect(options.headers["x-yoizen-user-id"]).toBe("user-42");
  });

  it("omits the trusted-user header when trustedUserId is absent", async () => {
    await service.proxyStream(fakeReply, {
      tenantId: "acme",
      body: {},
    });

    const [, options] = pipeUpstreamSseToReplyMock.mock.calls[0] as [
      unknown,
      { headers: Record<string, string> },
    ];
    expect(options.headers["x-yoizen-user-id"]).toBeUndefined();
  });

  it("passes the request body through unchanged", async () => {
    const body = { agentId: "a1", message: "hi", conversationId: "conv-1" };
    await service.proxyStream(fakeReply, { tenantId: "acme", body });

    const [, options] = pipeUpstreamSseToReplyMock.mock.calls[0] as [
      unknown,
      { body: unknown },
    ];
    expect(options.body).toEqual(body);
  });
});
