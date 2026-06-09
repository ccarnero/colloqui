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
}));

// ---------------------------------------------------------------------------
// Mock @nestjs/common Logger for controller-level logging
// ---------------------------------------------------------------------------
mock.module("@nestjs/common", () => ({
  Controller: () => (target: any) => target,
  Get: () => () => {},
  HttpCode: () => () => {},
  HttpStatus: { OK: 200 },
  Injectable: () => (target: any) => target,
  Logger: class MockLogger {
    log = mock(() => {});
    warn = mock(() => {});
    error = mock(() => {});
    constructor(_context?: string) {}
  },
}));

import { Test } from "@nestjs/testing";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";
import type { ToolDef } from "../../src/modules/tools/tool-definition";

// ---------------------------------------------------------------------------
// Fixture: builtin tool definitions
// ---------------------------------------------------------------------------
const COMMUNICATE_DEF: ToolDef = {
  name: "communicate",
  description: "Send, reply, notify, or escalate messages",
  builtin: true,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["send", "reply", "notify", "escalate"] },
      target_id: { type: "string" },
      message: { type: "string" },
    },
    required: ["action", "target_id"],
  },
};

const RESOURCE_DEF: ToolDef = {
  name: "resource",
  description: "Read or update external resources",
  builtin: true,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "list", "create", "update", "delete"] },
      resource_type: { type: "string" },
    },
    required: ["action", "resource_type"],
  },
};

// ---------------------------------------------------------------------------
// Tests for GET /tools/builtins
//
// The controller does not exist yet.  We import it dynamically inside each
// test to avoid hard-crash at module-load time.  The tests are designed to
// FAIL until the implementation is created.
// ---------------------------------------------------------------------------

describe("ToolsController — GET /tools/builtins", () => {
  let controller: any;
  let mockRegistry: {
    listBuiltinTools: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    mockRegistry = {
      listBuiltinTools: mock(() => []),
    };

    // Dynamically import the controller — will fail until it exists.
    try {
      const { ToolsController } = await import(
        "../../src/modules/tools/tools.controller"
      );
      const moduleRef = await Test.createTestingModule({
        controllers: [ToolsController],
        providers: [
          { provide: ToolRegistryService, useValue: mockRegistry },
        ],
      }).compile();
      controller = moduleRef.get(ToolsController);
    } catch {
      // Controller doesn't exist yet — set to null so tests fail with
      // a clear message instead of a module-not-found crash.
      controller = null;
    }
  });

  // =========================================================================
  //  Happy path
  // =========================================================================
  it("should return an array of builtin tool definitions", () => {
    mockRegistry.listBuiltinTools.mockReturnValueOnce([
      COMMUNICATE_DEF,
      RESOURCE_DEF,
    ]);

    expect(controller).not.toBeNull();
    const result = controller.listBuiltinTools();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("communicate");
    expect(result[1].name).toBe("resource");
  });

  it("should return an empty array when no builtins are registered", () => {
    mockRegistry.listBuiltinTools.mockReturnValueOnce([]);

    expect(controller).not.toBeNull();
    const result = controller.listBuiltinTools();

    expect(result).toEqual([]);
  });

  // =========================================================================
  //  Shape validation
  // =========================================================================
  it("should return objects with name, description, and inputSchema fields", () => {
    mockRegistry.listBuiltinTools.mockReturnValueOnce([COMMUNICATE_DEF]);

    expect(controller).not.toBeNull();
    const result = controller.listBuiltinTools();

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("name", "communicate");
    expect(result[0]).toHaveProperty("description");
    expect(result[0]).toHaveProperty("inputSchema");
  });

  it("should not expose handler or internal implementation details", () => {
    mockRegistry.listBuiltinTools.mockReturnValueOnce([COMMUNICATE_DEF]);

    expect(controller).not.toBeNull();
    const result = controller.listBuiltinTools();

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("handler");
    expect(result[0]).not.toHaveProperty("execute");
  });

  // =========================================================================
  //  Delegation
  // =========================================================================
  it("should delegate to registry.listBuiltinTools()", () => {
    mockRegistry.listBuiltinTools.mockReturnValueOnce([]);

    expect(controller).not.toBeNull();
    controller.listBuiltinTools();

    expect(mockRegistry.listBuiltinTools).toHaveBeenCalledTimes(1);
  });
});
