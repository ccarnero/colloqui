import "reflect-metadata";
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Stable mock references shared by every Logger instance created inside
// ToolRegistryService.  This lets us assert warn / error calls without
// reaching into the private `logger` field.
// ---------------------------------------------------------------------------
const logSpy   = mock(() => {});
const warnSpy  = mock(() => {});
const errorSpy = mock(() => {});

mock.module("@nestjs/common", () => ({
  Injectable: () => (target: any) => target, // eslint-disable-line @typescript-eslint/no-explicit-any
  Logger: class MockLogger {
    log   = logSpy;
    warn  = warnSpy;
    error = errorSpy;
    constructor(_context?: string) {}
  },
}));

import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";
import type {
  ToolDef,
  ToolHandler,
  RuntimeState,
} from "../../src/modules/tools/tool-definition";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDefinition(overrides?: Partial<ToolDef>): ToolDef {
  return {
    name: "test-tool",
    description: "A test tool",
    parameters: { type: "object" },
    ...overrides,
  };
}

function makeState(overrides?: Partial<RuntimeState>): RuntimeState {
  return {
    tenantId: "tenant-1",
    agentId: "agent-1",
    executionId: "exec-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ToolRegistryService", () => {
  let service: ToolRegistryService;

  beforeEach(() => {
    service = new ToolRegistryService();
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  // =========================================================================
  //  registerTool + getTool
  // =========================================================================
  describe("registerTool + getTool", () => {
    it("should register a tool and retrieve it via getTool", () => {
      const def = makeDefinition();
      service.registerTool(def);

      const registered = service.getTool("test-tool");
      expect(registered).toBeDefined();
      expect(registered!.definition).toBe(def);
    });

    it("should store handler as undefined when no handler is provided", () => {
      const def = makeDefinition();
      service.registerTool(def);

      const registered = service.getTool("test-tool");
      expect(registered!.handler).toBeUndefined();
    });

    it("should store the handler when one is provided", () => {
      const handler: ToolHandler = async () => ({
        success: true,
        output: "ok",
      });
      const def = makeDefinition();
      service.registerTool(def, handler);

      const registered = service.getTool("test-tool");
      expect(registered!.handler).toBe(handler);
    });

    it("should overwrite a duplicate tool and log a warning", () => {
      const def1 = makeDefinition({ description: "first" });
      const def2 = makeDefinition({ description: "second" });

      service.registerTool(def1);
      expect(warnSpy).toHaveBeenCalledTimes(0);

      service.registerTool(def2);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("test-tool");
      expect(
        service.getTool("test-tool")!.definition.description,
      ).toBe("second");
    });

    it("should register multiple tools and retrieve each independently", () => {
      const defA = makeDefinition({ name: "tool-a" });
      const defB = makeDefinition({ name: "tool-b" });

      service.registerTool(defA);
      service.registerTool(defB);

      expect(service.getTool("tool-a")!.definition).toBe(defA);
      expect(service.getTool("tool-b")!.definition).toBe(defB);
    });
  });

  // =========================================================================
  //  getToolDefinition
  // =========================================================================
  describe("getToolDefinition", () => {
    it("should return the definition for a registered tool", () => {
      const def = makeDefinition();
      service.registerTool(def);

      expect(service.getToolDefinition("test-tool")).toBe(def);
    });

    it("should return undefined for an unknown tool", () => {
      expect(service.getToolDefinition("nonexistent")).toBeUndefined();
    });
  });

  // =========================================================================
  //  listTools
  // =========================================================================
  describe("listTools", () => {
    it("should return an empty array when no tools are registered", () => {
      expect(service.listTools()).toEqual([]);
    });

    it("should return all registered tool definitions", () => {
      service.registerTool(makeDefinition({ name: "alpha" }));
      service.registerTool(makeDefinition({ name: "beta" }));

      const list = service.listTools();
      expect(list).toHaveLength(2);
      expect(list.map((d) => d.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("should return only definitions, not RegisteredTool objects", () => {
      const handler: ToolHandler = async () => ({
        success: true,
        output: null,
      });
      service.registerTool(makeDefinition(), handler);

      const list = service.listTools();
      expect(list).toHaveLength(1);
      // Each element is a plain ToolDef — no `handler` property
      expect(list[0]).toEqual(makeDefinition());
    });
  });

  // =========================================================================
  //  hasTool
  // =========================================================================
  describe("hasTool", () => {
    it("should return true for a registered tool", () => {
      service.registerTool(makeDefinition());
      expect(service.hasTool("test-tool")).toBe(true);
    });

    it("should return false for an unknown tool", () => {
      expect(service.hasTool("nonexistent")).toBe(false);
    });
  });

  // =========================================================================
  //  executeBuiltin
  // =========================================================================
  describe("executeBuiltin", () => {
    const state = makeState();
    const params = { key: "value" };

    it("should return not-found error for an unknown tool", async () => {
      const result = await service.executeBuiltin("missing", params, state);

      expect(result.success).toBe(false);
      expect(result.output).toBeNull();
      expect(result.error).toBe("Tool 'missing' not found");
    });

    it("should return no-handler error when tool has no builtin handler", async () => {
      service.registerTool(makeDefinition());

      const result = await service.executeBuiltin("test-tool", params, state);

      expect(result.success).toBe(false);
      expect(result.output).toBeNull();
      expect(result.error).toBe(
        "Tool 'test-tool' has no builtin handler",
      );
    });

    it("should pass through a successful handler result", async () => {
      const handlerResult = { success: true, output: { answer: 42 } };
      const handler: ToolHandler = async () => handlerResult;
      service.registerTool(makeDefinition(), handler);

      const result = await service.executeBuiltin("test-tool", params, state);

      expect(result).toEqual(handlerResult);
      expect(result.success).toBe(true);
    });

    it("should handle a synchronous handler returning ToolResult directly", async () => {
      const handler: ToolHandler = () => ({
        success: true,
        output: "sync",
      });
      service.registerTool(makeDefinition(), handler);

      const result = await service.executeBuiltin(
        "test-tool",
        params,
        state,
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe("sync");
    });

    it("should return error with message when handler throws an Error", async () => {
      const handler: ToolHandler = async () => {
        throw new Error("something broke");
      };
      service.registerTool(makeDefinition(), handler);

      const result = await service.executeBuiltin("test-tool", params, state);

      expect(result.success).toBe(false);
      expect(result.output).toBeNull();
      expect(result.error).toBe("something broke");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("should return String(err) when handler throws a non-Error value", async () => {
      const handler: ToolHandler = async () => {
        throw "plain string error"; // eslint-disable-line no-throw-literal
      };
      service.registerTool(makeDefinition(), handler);

      const result = await service.executeBuiltin("test-tool", params, state);

      expect(result.success).toBe(false);
      expect(result.error).toBe("plain string error");
    });

    it("should pass params and state unchanged to the handler", async () => {
      let receivedParams: Record<string, unknown> | undefined;
      let receivedState: RuntimeState | undefined;

      const handler: ToolHandler = async (p, s) => {
        receivedParams = p;
        receivedState = s;
        return { success: true, output: null };
      };

      service.registerTool(makeDefinition(), handler);
      await service.executeBuiltin("test-tool", params, state);

      expect(receivedParams).toBe(params);
      expect(receivedState).toBe(state);
    });
  });

  // =========================================================================
  //  clear
  // =========================================================================
  describe("clear", () => {
    it("should remove all tools so listTools returns []", () => {
      service.registerTool(makeDefinition({ name: "a" }));
      service.registerTool(makeDefinition({ name: "b" }));
      service.clear();

      expect(service.listTools()).toEqual([]);
    });

    it("should make hasTool return false for previously registered tools", () => {
      service.registerTool(makeDefinition());
      service.clear();

      expect(service.hasTool("test-tool")).toBe(false);
    });

    it("should allow registering tools again after clearing", () => {
      service.registerTool(makeDefinition({ description: "before" }));
      service.clear();

      const newDef = makeDefinition({ description: "after" });
      service.registerTool(newDef);

      expect(service.hasTool("test-tool")).toBe(true);
      expect(service.getToolDefinition("test-tool")!.description).toBe(
        "after",
      );
    });
  });

  // =========================================================================
  //  Edge cases
  // =========================================================================
  describe("Edge cases", () => {
    it("should register and retrieve a tool with an empty name", () => {
      const def = makeDefinition({ name: "" });
      service.registerTool(def);

      expect(service.hasTool("")).toBe(true);
      expect(service.getToolDefinition("")).toBe(def);
    });

    it("should return the new definition after overwriting a tool", () => {
      const v1 = makeDefinition({ description: "v1" });
      const v2 = makeDefinition({ description: "v2" });

      service.registerTool(v1);
      service.registerTool(v2);

      expect(service.getToolDefinition("test-tool")).toBe(v2);
    });

    it("should return not-found when executing after clear", async () => {
      const handler: ToolHandler = async () => ({
        success: true,
        output: "ok",
      });
      service.registerTool(makeDefinition(), handler);
      service.clear();

      const result = await service.executeBuiltin(
        "test-tool",
        {},
        makeState(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool 'test-tool' not found");
    });

    it("should log on every register call", () => {
      service.registerTool(makeDefinition({ name: "x" }));
      service.registerTool(makeDefinition({ name: "y" }));

      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });
});
