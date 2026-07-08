import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @yoizen/observability to avoid pulling real pino / OTEL deps.
// ToolRegistryService field-initialises a Logger; the mock must be in place
// at module load time.
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
// Mock the ai module — we only need tool() and jsonSchema() as pass-throughs.
// ---------------------------------------------------------------------------
mock.module("ai", () => ({
  tool: mock((opts: any) => ({
    type: "function" as const,
    description: opts.description,
    inputSchema: opts.inputSchema,
    execute: opts.execute,
  })),
  jsonSchema: mock((schema: any) => schema),
}));

import { Test } from "@nestjs/testing";
import { AdapterExecutorService } from "../../src/modules/tools/adapter-executor.service";
import { McpClientService } from "../../src/modules/tools/mcp-client.service";
import { ToolBridgeService } from "../../src/modules/tools/tool-bridge.service";
import type {
  RuntimeState,
  ToolDef,
} from "../../src/modules/tools/tool-definition";
import { ToolExecutorService } from "../../src/modules/tools/tool-executor.service";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const state: RuntimeState = {
  tenantId: "t-1",
  agentId: "a-1",
  executionId: "e-1",
};

const calculatorDef: ToolDef = {
  name: "calculator",
  description: "Evaluate a math expression",
  inputSchema: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
};

const weatherDef: ToolDef = {
  name: "weather",
  description: "Get current weather for a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

const adapterToolRaw = {
  name: "search_tickets",
  description: "Search support tickets",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  adapterRef: { adapterId: "zendesk-adapter", endpointId: "search" },
};

const builtinToolRaw = {
  name: "communicate",
  builtin: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ToolBridgeService", () => {
  let bridge: ToolBridgeService;
  let mockRegistry: {
    listTools: ReturnType<typeof mock>;
    getToolDefinition: ReturnType<typeof mock>;
    hasTool: ReturnType<typeof mock>;
    getTool: ReturnType<typeof mock>;
  };
  let mockExecutor: {
    executeTool: ReturnType<typeof mock>;
  };
  let mockAdapterExecutor: {
    execute: ReturnType<typeof mock>;
  };
  let mockMcpClient: {
    connect: ReturnType<typeof mock>;
    getTools: ReturnType<typeof mock>;
    getAllTools: ReturnType<typeof mock>;
    getConnectedServers: ReturnType<typeof mock>;
    getServerId: ReturnType<typeof mock>;
    disconnect: ReturnType<typeof mock>;
    disconnectAll: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    mockRegistry = {
      listTools: mock(() => []),
      getToolDefinition: mock(() => undefined),
      hasTool: mock(() => false),
      getTool: mock(() => undefined),
    };
    mockExecutor = {
      executeTool: mock(() => Promise.resolve({ success: true, output: "ok" })),
    };
    mockAdapterExecutor = {
      execute: mock(() =>
        Promise.resolve({ success: true, output: "adapter-ok" })
      ),
    };
    mockMcpClient = {
      connect: mock(() => Promise.resolve()),
      getTools: mock(() => Promise.resolve({})),
      getAllTools: mock(() => Promise.resolve({})),
      getConnectedServers: mock(() => []),
      getServerId: mock(() => undefined),
      disconnect: mock(() => Promise.resolve()),
      disconnectAll: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ToolBridgeService,
        { provide: ToolRegistryService, useValue: mockRegistry },
        { provide: ToolExecutorService, useValue: mockExecutor },
        { provide: AdapterExecutorService, useValue: mockAdapterExecutor },
        { provide: McpClientService, useValue: mockMcpClient },
      ],
    }).compile();

    bridge = moduleRef.get(ToolBridgeService);
  });

  // ────────────────────────────────────────────────────────────────────────
  // toAiSdkTools
  // ────────────────────────────────────────────────────────────────────────

  describe("toAiSdkTools", () => {
    it("should return empty object when registry has no tools", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => []);

      const tools = await bridge.toAiSdkTools(state);

      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("should convert a single tool with correct name, description, and parameters", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);

      const tools = await bridge.toAiSdkTools(state);

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["calculator"]).toBeDefined();
      expect(tools["calculator"].description).toBe(
        "Evaluate a math expression"
      );
      expect(tools["calculator"].inputSchema).toEqual(
        calculatorDef.inputSchema
      );
    });

    it("should convert multiple tools preserving all names", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [
        calculatorDef,
        weatherDef,
      ]);

      const tools = await bridge.toAiSdkTools(state);

      expect(Object.keys(tools)).toHaveLength(2);
      expect(tools["calculator"]).toBeDefined();
      expect(tools["weather"]).toBeDefined();
      expect(tools["calculator"].description).toBe(calculatorDef.description);
      expect(tools["weather"].description).toBe(weatherDef.description);
    });

    it("should set type=function on each converted tool", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);

      const tools = await bridge.toAiSdkTools(state);

      expect((tools["calculator"] as any).type).toBe("function");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // toAiSdkToolsByName
  // ────────────────────────────────────────────────────────────────────────

  describe("toAiSdkToolsByName", () => {
    it("should return only the requested subset of tools", async () => {
      mockRegistry.getToolDefinition.mockImplementation((name: string) => {
        if (name === "calculator") {
          return calculatorDef;
        }
        if (name === "weather") {
          return weatherDef;
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsByName(["calculator"], state);

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["calculator"]).toBeDefined();
      expect(tools["weather"]).toBeUndefined();
    });

    it("should skip unknown tool names without error", async () => {
      mockRegistry.getToolDefinition.mockImplementation(() => undefined);

      const tools = await bridge.toAiSdkToolsByName(
        ["nonexistent", "also-missing"],
        state
      );

      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("should mix known and unknown names, returning only known", async () => {
      mockRegistry.getToolDefinition.mockImplementation((name: string) => {
        if (name === "calculator") {
          return calculatorDef;
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsByName(
        ["calculator", "ghost"],
        state
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["calculator"]).toBeDefined();
    });

    it("should return empty object for empty name list", async () => {
      const tools = await bridge.toAiSdkToolsByName([], state);

      expect(Object.keys(tools)).toHaveLength(0);
      expect(mockRegistry.getToolDefinition).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // execute function delegation
  // ────────────────────────────────────────────────────────────────────────

  describe("execute function", () => {
    it("should delegate to executor.executeTool with correct args", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);
      mockExecutor.executeTool.mockImplementationOnce(() =>
        Promise.resolve({ success: true, output: "42" })
      );

      const tools = await bridge.toAiSdkTools(state);
      const result = await tools["calculator"].execute!(
        { expression: "6*7" },
        { toolCallId: "tc-1", messages: [] }
      );

      expect(mockExecutor.executeTool).toHaveBeenCalledWith(
        "calculator",
        { expression: "6*7" },
        state
      );
      expect(result).toBe("42");
    });

    it("should return output when executor returns success=true", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);
      mockExecutor.executeTool.mockImplementationOnce(() =>
        Promise.resolve({ success: true, output: { temp: 72, unit: "F" } })
      );

      const tools = await bridge.toAiSdkTools(state);
      const result = await tools["calculator"].execute!(
        { expression: "check" },
        { toolCallId: "tc-2", messages: [] }
      );

      expect(result).toEqual({ temp: 72, unit: "F" });
    });

    it("should throw when executor returns success=false", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);
      mockExecutor.executeTool.mockImplementationOnce(() =>
        Promise.resolve({
          success: false,
          output: null,
          error: "Division by zero",
        })
      );

      const tools = await bridge.toAiSdkTools(state);

      await expect(
        tools["calculator"].execute!(
          { expression: "1/0" },
          { toolCallId: "tc-3", messages: [] }
        )
      ).rejects.toThrow("Division by zero");
    });

    it("should throw default message when executor returns success=false without error", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);
      mockExecutor.executeTool.mockImplementationOnce(() =>
        Promise.resolve({ success: false, output: null })
      );

      const tools = await bridge.toAiSdkTools(state);

      await expect(
        tools["calculator"].execute!(
          { expression: "bad" },
          { toolCallId: "tc-4", messages: [] }
        )
      ).rejects.toThrow("Tool 'calculator' failed");
    });

    it("should propagate executor exceptions", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [calculatorDef]);
      mockExecutor.executeTool.mockImplementationOnce(() =>
        Promise.reject(new Error("Network timeout"))
      );

      const tools = await bridge.toAiSdkTools(state);

      await expect(
        tools["calculator"].execute!(
          { expression: "test" },
          { toolCallId: "tc-5", messages: [] }
        )
      ).rejects.toThrow("Network timeout");
    });

    it("should pass state from toAiSdkTools to executor for each tool", async () => {
      mockRegistry.listTools.mockImplementationOnce(() => [
        calculatorDef,
        weatherDef,
      ]);
      mockExecutor.executeTool.mockImplementation(() =>
        Promise.resolve({ success: true, output: "ok" })
      );

      const tools = await bridge.toAiSdkTools(state);
      await tools["calculator"].execute!(
        { expression: "1+1" },
        { toolCallId: "tc-6", messages: [] }
      );
      await tools["weather"].execute!(
        { city: "NYC" },
        { toolCallId: "tc-7", messages: [] }
      );

      expect(mockExecutor.executeTool).toHaveBeenCalledTimes(2);
      expect(mockExecutor.executeTool).toHaveBeenCalledWith(
        "calculator",
        { expression: "1+1" },
        state
      );
      expect(mockExecutor.executeTool).toHaveBeenCalledWith(
        "weather",
        { city: "NYC" },
        state
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // toAiSdkToolsForAgent
  // ────────────────────────────────────────────────────────────────────────

  describe("toAiSdkToolsForAgent", () => {
    it("should return empty object for empty agent tools", async () => {
      const tools = await bridge.toAiSdkToolsForAgent([], state);
      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("should delegate builtin tools to registry", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") {
          return {
            definition: {
              name: "communicate",
              description: "Send a message",
              inputSchema: { type: "object", properties: {} },
              builtin: true,
            },
          };
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent([builtinToolRaw], state);

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["communicate"].description).toBe("Send a message");
    });

    it("should create adapter tool with adapterExecutor", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);

      const tools = await bridge.toAiSdkToolsForAgent([adapterToolRaw], state);

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["search_tickets"]).toBeDefined();
      expect(tools["search_tickets"].description).toBe(
        "Search support tickets"
      );
    });

    it("should call adapterExecutor.execute when adapter tool is invoked", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);
      mockAdapterExecutor.execute.mockImplementationOnce(() =>
        Promise.resolve({ success: true, output: { tickets: [1, 2] } })
      );

      const tools = await bridge.toAiSdkToolsForAgent([adapterToolRaw], state);
      const result = await tools["search_tickets"].execute!(
        { query: "broken printer" },
        { toolCallId: "tc-adapter-1", messages: [] }
      );

      expect(mockAdapterExecutor.execute).toHaveBeenCalledWith(
        "t-1",
        { adapterId: "zendesk-adapter", endpointId: "search" },
        { query: "broken printer" },
        { tenantId: "t-1", agentId: "a-1", executionId: "e-1" }
      );
      expect(result).toEqual({ tickets: [1, 2] });
    });

    it("should throw when adapter tool execution fails", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);
      mockAdapterExecutor.execute.mockImplementationOnce(() =>
        Promise.resolve({
          success: false,
          output: null,
          error: "Adapter timeout",
        })
      );

      const tools = await bridge.toAiSdkToolsForAgent([adapterToolRaw], state);

      await expect(
        tools["search_tickets"].execute!(
          { query: "test" },
          { toolCallId: "tc-adapter-2", messages: [] }
        )
      ).rejects.toThrow("Adapter timeout");
    });

    it("should skip unknown tool with no execution path", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);

      const unknownTool = { name: "mystery", description: "Unknown" };
      const tools = await bridge.toAiSdkToolsForAgent([unknownTool], state);

      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("should handle mix of builtin + adapter tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") {
          return {
            definition: {
              name: "communicate",
              description: "Send a message",
              inputSchema: { type: "object", properties: {} },
              builtin: true,
            },
          };
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinToolRaw, adapterToolRaw],
        state
      );

      expect(Object.keys(tools)).toHaveLength(2);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["search_tickets"]).toBeDefined();
    });

    it("should skip malformed tool entries gracefully", async () => {
      const tools = await bridge.toAiSdkToolsForAgent(
        [null, undefined, 42, "", { noName: true }, {}],
        state
      );

      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("should use default parameters when tool has none", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);

      const toolWithNoParams = {
        name: "bare_tool",
        description: "No params",
        adapterRef: { adapterId: "some-adapter", endpointId: "ep1" },
      };
      const tools = await bridge.toAiSdkToolsForAgent(
        [toolWithNoParams],
        state
      );

      expect(tools["bare_tool"]).toBeDefined();
      expect(tools["bare_tool"].inputSchema).toEqual({
        type: "object",
        properties: {},
      });
    });

    it("parses snake_case adapter_ref correctly", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);
      mockAdapterExecutor.execute.mockImplementationOnce(() =>
        Promise.resolve({ success: true, output: "snake-ok" })
      );

      const snakeTool = {
        name: "snake_tool",
        description: "Tool with snake_case adapter_ref",
        parameters: {
          type: "object",
          properties: { q: { type: "string" } },
        },
        adapter_ref: { adapter_id: "a1", endpoint_id: "e1" },
      };

      const tools = await bridge.toAiSdkToolsForAgent([snakeTool], state);

      expect(tools["snake_tool"]).toBeDefined();
      expect(tools["snake_tool"].description).toBe(
        "Tool with snake_case adapter_ref"
      );

      // Verify adapterRef was parsed with correct IDs
      return tools["snake_tool"].execute!(
        { q: "test" },
        { toolCallId: "tc-snake", messages: [] }
      ).then(() => {
        expect(mockAdapterExecutor.execute).toHaveBeenCalledWith(
          "t-1",
          { adapterId: "a1", endpointId: "e1" },
          { q: "test" },
          { tenantId: "t-1", agentId: "a-1", executionId: "e-1" }
        );
      });
    });

    it("detects source_type builtin as builtin", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") {
          return {
            definition: {
              name: "communicate",
              description: "Send a message",
              inputSchema: { type: "object", properties: {} },
              builtin: true,
            },
          };
        }
        return undefined;
      });

      const sourceTypeBuiltin = {
        name: "communicate",
        source_type: "builtin",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [sourceTypeBuiltin],
        state
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["communicate"].description).toBe("Send a message");
    });

    it("handles mixed camelCase and snake_case", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);
      mockAdapterExecutor.execute.mockImplementationOnce(() =>
        Promise.resolve({ success: true, output: "mixed-ok" })
      );

      const mixedTool = {
        name: "mixed_tool",
        description: "camelCase adapterRef with snake_case inner fields",
        parameters: { type: "object", properties: {} },
        adapterRef: { adapter_id: "a-mixed", endpoint_id: "e-mixed" },
      };

      const tools = await bridge.toAiSdkToolsForAgent([mixedTool], state);

      expect(tools["mixed_tool"]).toBeDefined();

      return tools["mixed_tool"].execute!(
        {},
        { toolCallId: "tc-mixed", messages: [] }
      ).then(() => {
        expect(mockAdapterExecutor.execute).toHaveBeenCalledWith(
          "t-1",
          { adapterId: "a-mixed", endpointId: "e-mixed" },
          {},
          { tenantId: "t-1", agentId: "a-1", executionId: "e-1" }
        );
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // mergeMcpTools — enabledMcpServers must be keyed by server NAME, not id
  // (regression test: enabled_mcp_servers was previously saved by id from
  // admin-console but filtered by name here, via
  // McpClientService.getConnectedServers(), silently dropping every MCP
  // tool for agents with an explicit server allowlist).
  // ────────────────────────────────────────────────────────────────────────

  describe("toAiSdkToolsForAgent — MCP server allowlist filtering", () => {
    const githubMcpToolRaw = {
      list_issues: {
        type: "function" as const,
        description: "List GitHub issues",
        inputSchema: { type: "object", properties: {} },
        execute: mock(() => Promise.resolve("ok")),
      },
    };

    it("merges MCP tools when the allowlist matches the connected server NAME", async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve(githubMcpToolRaw)
      );

      const tools = await bridge.toAiSdkToolsForAgent(
        [],
        state,
        null, // enabled tools
        ["github-mcp"] // enabled MCP servers — server NAME, matching getConnectedServers()
      );

      expect(tools["list_issues"]).toBeDefined();
    });

    it("drops all MCP tools when the allowlist contains the server's id instead of its name", async () => {
      // This reproduces the original bug: admin-console saved
      // `enabled_mcp_servers` by server id (e.g. a UUID), but
      // `getConnectedServers()` only ever returns names.
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve(githubMcpToolRaw)
      );

      const tools = await bridge.toAiSdkToolsForAgent(
        [],
        state,
        null,
        ["11111111-2222-3333-4444-555555555555"] // server id, NOT its name
      );

      expect(tools["list_issues"]).toBeUndefined();
      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("merges all connected MCP servers' tools when the allowlist is null", async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve(githubMcpToolRaw)
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null);

      expect(tools["list_issues"]).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // MCP tool execution timeout (ASYNC-RESILIENCE-AUDIT.md F2) — an
  // unresponsive MCP server's execute() must surface a tool error, not hang
  // the agent loop indefinitely. withMcpUsageLogging wraps every merged MCP
  // tool's execute with withTimeout(mcpLiveCallTimeoutMs).
  // ────────────────────────────────────────────────────────────────────────

  describe("mergeMcpTools — execute timeout (F2)", () => {
    const originalTimeoutEnv = process.env.MCP_LIVE_CALL_TIMEOUT_MS;

    afterEach(() => {
      if (originalTimeoutEnv === undefined) {
        delete process.env.MCP_LIVE_CALL_TIMEOUT_MS;
      } else {
        process.env.MCP_LIVE_CALL_TIMEOUT_MS = originalTimeoutEnv;
      }
    });

    it("rejects with a timeout error instead of hanging when the MCP tool's execute never resolves", async () => {
      process.env.MCP_LIVE_CALL_TIMEOUT_MS = "10";

      const hangingToolRaw = {
        list_issues: {
          type: "function" as const,
          description: "List GitHub issues",
          inputSchema: { type: "object", properties: {} },
          execute: mock(() => new Promise(() => {})), // never resolves
        },
      };
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve(hangingToolRaw)
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state);

      await expect(
        tools["list_issues"].execute!(
          {},
          { toolCallId: "tc-hang", messages: [] }
        )
      ).rejects.toThrow(/timed out after 10ms/);
    });
  });
});
