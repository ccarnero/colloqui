import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ProxyController } from "../../src/modules/proxy/proxy.controller";
import { ProxyService } from "../../src/modules/proxy/proxy.service";

describe("ProxyController", () => {
  let controller: ProxyController;
  let proxyService: {
    handleGeneric: ReturnType<typeof mock>;
    handleYSocial: ReturnType<typeof mock>;
    handleYFlow: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    proxyService = {
      handleGeneric: mock(() => Promise.resolve()),
      handleYSocial: mock(() => Promise.resolve()),
      handleYFlow: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProxyController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    }).compile();

    controller = moduleRef.get(ProxyController);
  });

  it("delegates generic routes to ProxyService.handleGeneric", async () => {
    const req = {
      method: "GET",
      url: "/proxy/generic/x",
    } as import("fastify").FastifyRequest;
    const reply = {} as import("fastify").FastifyReply;
    await controller.handleGenericPath(req, reply);
    expect(proxyService.handleGeneric).toHaveBeenCalledWith(req, reply);
  });

  it("delegates ysocial routes to handleYSocial", async () => {
    const req = {} as import("fastify").FastifyRequest;
    const reply = {} as import("fastify").FastifyReply;
    await controller.handleYSocialRoot(req, reply);
    expect(proxyService.handleYSocial).toHaveBeenCalledWith(req, reply);
  });

  it("delegates generic root to handleGeneric", async () => {
    const req = {} as import("fastify").FastifyRequest;
    const reply = {} as import("fastify").FastifyReply;
    await controller.handleGenericRoot(req, reply);
    expect(proxyService.handleGeneric).toHaveBeenCalledWith(req, reply);
  });

  it("delegates ysocial path to handleYSocial", async () => {
    const req = {} as import("fastify").FastifyRequest;
    const reply = {} as import("fastify").FastifyReply;
    await controller.handleYSocialPath(req, reply);
    expect(proxyService.handleYSocial).toHaveBeenCalledWith(req, reply);
  });

  it("delegates yflow root and path to handleYFlow", async () => {
    const req = {} as import("fastify").FastifyRequest;
    const reply = {} as import("fastify").FastifyReply;
    await controller.handleYFlowRoot(req, reply);
    expect(proxyService.handleYFlow).toHaveBeenCalledWith(req, reply);
    await controller.handleYFlowPath(req, reply);
    expect(proxyService.handleYFlow).toHaveBeenCalledTimes(2);
  });
});

