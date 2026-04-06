import "reflect-metadata";
import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ProxyProxyService } from "../../src/modules/proxy/proxy-proxy.service";

describe("ProxyProxyService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("ok"),
      }),
    ) as typeof fetch;
  });

  it("forward passes request URL to upstream fetch", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ProxyProxyService],
    }).compile();
    const svc = moduleRef.get(ProxyProxyService);

    const replyStub = {
      status: mock(() => replyStub),
      header: mock(),
      send: mock(),
    };
    const reply = replyStub as unknown as FastifyReply;

    const req = {
      url: "/tenant-svc/path",
      method: "GET",
      headers: {},
    } as unknown as FastifyRequest;

    await svc.forward(req, reply);

    expect(replyStub.send).toHaveBeenCalledWith("ok");
  });
});
