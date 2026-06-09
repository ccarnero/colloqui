import "reflect-metadata";
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @yoizen/observability
// ---------------------------------------------------------------------------
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockPinoLoggerService {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
  },
  tracedFetch: mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ name: "communicate", builtin: true }]),
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Mock @yoizen/shared — platformServiceUrl
// ---------------------------------------------------------------------------
mock.module("@yoizen/shared", () => ({
  platformServiceUrl: (name: string, env: string) =>
    `http://${name}.platform-services-${env}.svc.cluster.local`,
  TENANT_HEADER: "x-yoizen-tenant",
}));

import { Test } from "@nestjs/testing";
import { ToolsController } from "../../src/modules/tools/tools.controller";
import { ToolsService } from "../../src/modules/tools/tools.service";

describe("ToolsController — GET /tools/builtins", () => {
  let controller: ToolsController;
  let service: ToolsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ToolsController],
      providers: [ToolsService],
    }).compile();

    controller = moduleRef.get(ToolsController);
    service = moduleRef.get(ToolsService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it("should return builtin tools from agent-ai-service", async () => {
    const result = await controller.listBuiltinTools();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("name", "communicate");
    expect(result[0]).toHaveProperty("builtin", true);
  });
});
