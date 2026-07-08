import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @yoizen/observability to avoid pulling real pino / OTEL deps.
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
    parameters: opts.parameters,
    execute: opts.execute,
    inputSchema: opts.inputSchema,
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

// ---------------------------------------------------------------------------
// Feature flag key — mirroring the config key used by the bridge.
// ---------------------------------------------------------------------------
const FEATURE_FLAG_KEY = "agent.tool_description_overrides_enabled";

// ── Fixtures ──────────────────────────────────────────────────────────────

const state: RuntimeState = {
  tenantId: "t-1",
  agentId: "a-1",
  executionId: "e-1",
};

const memoryDef: ToolDef = {
  name: "memory",
  description: "Store and retrieve conversation data",
  builtin: true,
  inputSchema: { type: "object", properties: {} },
};

const communicateDef: ToolDef = {
  name: "communicate",
  description: "Send a message",
  builtin: true,
  inputSchema: { type: "object", properties: {} },
};

const resourceDef: ToolDef = {
  name: "resource",
  description: "Manage resources",
  builtin: true,
  inputSchema: { type: "object", properties: {} },
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

const customToolRaw = {
  name: "custom_calc",
  description: "A custom calculator tool",
  parameters: {
    type: "object",
    properties: { expr: { type: "string" } },
    required: ["expr"],
  },
};

const builtinMemoryRaw = {
  name: "memory",
  builtin: true,
};

const builtinCommunicateRaw = {
  name: "communicate",
  builtin: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ToolBridgeService — description overrides", () => {
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
    disconnect: ReturnType<typeof mock>;
    disconnectAll: ReturnType<typeof mock>;
  };

  let origDescriptionOverridesEnabled: string | undefined;

  beforeEach(async () => {
    // The description-overrides feature is gated behind
    // AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED (config.ts), which defaults
    // to disabled. Most tests in this file exercise the override behavior
    // itself, so default the flag ON here; the dedicated "feature flag is
    // OFF/ON" tests below explicitly set/restore their own value.
    origDescriptionOverridesEnabled =
      process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED;
    process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = "true";

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

  afterEach(() => {
    process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED =
      origDescriptionOverridesEnabled;
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Baseline: no overrides → registered description is used
  // ══════════════════════════════════════════════════════════════════════════

  describe("when no description overrides are provided", () => {
    it("should use the registered description for builtin tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      // toAiSdkToolsForAgent(agentTools, state, enabledTools, enabledMcpServers, toolDescriptionOverrides)
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null, // enabled tools
        null, // enabled MCP servers
        null // tool description overrides
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe(
        "Store and retrieve conversation data"
      );
    });

    it("should use the registered description when overrides map is undefined", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null,
        null,
        undefined // tool description overrides undefined
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe(
        "Store and retrieve conversation data"
      );
    });

    it("should use the registered description when overrides map is empty", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null,
        null,
        {} // tool description overrides empty
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe(
        "Store and retrieve conversation data"
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Override applies to builtin tools
  // ══════════════════════════════════════════════════════════════════════════

  describe("when description overrides are provided for builtin tools", () => {
    it("should use the override description when agent has overrides for the tool", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      const overrides: Record<string, string> = {
        memory: "Store/retrieve conversation data (customized)",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe(
        "Store/retrieve conversation data (customized)"
      );
    });

    it("should use the override description for multiple builtin tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) =>
          name === "memory" || name === "communicate" || name === "resource"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        if (name === "communicate") {
          return { definition: communicateDef };
        }
        if (name === "resource") {
          return { definition: resourceDef };
        }
        return undefined;
      });

      const overrides: Record<string, string> = {
        memory: "Memory override",
        communicate: "Communicate override",
        resource: "Resource override",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [
          builtinMemoryRaw,
          builtinCommunicateRaw,
          { name: "resource", builtin: true },
        ],
        state,
        null,
        null,
        overrides
      );

      expect(tools["memory"].description).toBe("Memory override");
      expect(tools["communicate"].description).toBe("Communicate override");
      expect(tools["resource"].description).toBe("Resource override");
    });

    it("should not apply overrides for tools not named in the overrides map", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory" || name === "communicate"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        if (name === "communicate") {
          return { definition: communicateDef };
        }
        return undefined;
      });

      // Only override "memory", not "communicate"
      const overrides: Record<string, string> = {
        memory: "Only memory overridden",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw, builtinCommunicateRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["memory"].description).toBe("Only memory overridden");
      expect(tools["communicate"].description).toBe("Send a message");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Override applies to adapter / custom tools (any tool the agent declares)
  // ══════════════════════════════════════════════════════════════════════════

  describe("when description overrides are provided for adapter / custom tools", () => {
    it("should apply the override for an adapter tool's description", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);

      const overrides: Record<string, string> = {
        search_tickets: "Search support tickets (customized description)",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [adapterToolRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["search_tickets"]).toBeDefined();
      expect(tools["search_tickets"].description).toBe(
        "Search support tickets (customized description)"
      );
    });

    it("should skip a tool with no execution path (non-builtin, non-adapter) even with an override", async () => {
      // A tool that is neither builtin nor carries an adapterRef has no
      // execution path (tool-bridge.service.ts `toAiSdkToolsForAgent`) and
      // is skipped outright — a description override does not fabricate
      // one. Matches the established "skip unknown tool with no execution
      // path" behavior asserted in tool-bridge.service.spec.ts.
      mockRegistry.hasTool.mockImplementation(() => false);

      const overrides: Record<string, string> = {
        custom_calc: "Custom calculator (overridden description)",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [customToolRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["custom_calc"]).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Unknown tool name — stored but ignored at runtime
  // ══════════════════════════════════════════════════════════════════════════

  describe("when overrides contain names not matching agent tools", () => {
    it("should ignore overrides for unknown tool names", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      // "nonexistent_tool" is in overrides but not in agent tools
      const overrides: Record<string, string> = {
        memory: "Memory override",
        nonexistent_tool: "This should be ignored",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe("Memory override");
      // The nonexistent tool is not in agent's tools, so it's not created
      expect(tools["nonexistent_tool"]).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Feature flag: OFF → registered description always used
  // ══════════════════════════════════════════════════════════════════════════

  describe("when feature flag is OFF", () => {
    it("should use the registered description even when overrides are present", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      // With flag OFF, the bridge ignores the overrides map entirely.
      const origEnv = process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED;
      process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = "false";
      try {
        const tools = await bridge.toAiSdkToolsForAgent(
          [builtinMemoryRaw],
          state,
          null,
          null,
          { memory: "Should be ignored" } // real overrides, but flag is OFF
        );

        expect(tools["memory"]).toBeDefined();
        expect(tools["memory"].description).toBe(
          "Store and retrieve conversation data"
        );
      } finally {
        process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = origEnv;
      }
    });

    it("should use the override when feature flag is ON", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      const origEnv = process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED;
      process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = "true";
      try {
        const tools = await bridge.toAiSdkToolsForAgent(
          [builtinMemoryRaw],
          state,
          null,
          null,
          { memory: "Custom override when ON" }
        );

        expect(tools["memory"]).toBeDefined();
        expect(tools["memory"].description).toBe("Custom override when ON");
      } finally {
        process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = origEnv;
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Edge cases
  // ══════════════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("should handle null overrides map for all tool types", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory" || name === "communicate"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        if (name === "communicate") {
          return { definition: communicateDef };
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw, builtinCommunicateRaw],
        state,
        null,
        null,
        null
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe(
        "Store and retrieve conversation data"
      );
      expect(tools["communicate"]).toBeDefined();
      expect(tools["communicate"].description).toBe("Send a message");
    });

    it("should handle empty overrides map gracefully", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null,
        null,
        {}
      );

      expect(tools["memory"]).toBeDefined();
      expect(tools["memory"].description).toBe(
        "Store and retrieve conversation data"
      );
    });

    it("should handle overrides with empty string values gracefully", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "memory"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        return undefined;
      });

      const overrides: Record<string, string> = {
        memory: "",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinMemoryRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["memory"]).toBeDefined();
      // Empty string override should still be applied (the agent explicitly set it)
      expect(tools["memory"].description).toBe("");
    });

    it("should not affect tools when overrides map has unrelated keys", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") {
          return { definition: communicateDef };
        }
        return undefined;
      });

      const overrides: Record<string, string> = {
        some_other_tool: "irrelevant",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw],
        state,
        null,
        null,
        overrides
      );

      expect(tools["communicate"]).toBeDefined();
      expect(tools["communicate"].description).toBe("Send a message");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Concurrent: two tools with different overrides
  // ══════════════════════════════════════════════════════════════════════════

  describe("concurrent scenario — multiple tools with different overrides", () => {
    it("should resolve each tool to its own override independently", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) =>
          name === "memory" || name === "communicate" || name === "resource"
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "memory") {
          return { definition: memoryDef };
        }
        if (name === "communicate") {
          return { definition: communicateDef };
        }
        if (name === "resource") {
          return { definition: resourceDef };
        }
        return undefined;
      });

      const overrides: Record<string, string> = {
        memory: "Custom memory desc",
        communicate: "Custom communicate desc",
        resource: "Custom resource desc",
      };

      const tools = await bridge.toAiSdkToolsForAgent(
        [
          builtinMemoryRaw,
          builtinCommunicateRaw,
          { name: "resource", builtin: true },
        ],
        state,
        null,
        null,
        overrides
      );

      // Each tool gets its own override independently
      expect(tools["memory"].description).toBe("Custom memory desc");
      expect(tools["communicate"].description).toBe("Custom communicate desc");
      expect(tools["resource"].description).toBe("Custom resource desc");

      // Verify the descriptions are all different — no cross-contamination
      expect(tools["memory"].description).not.toBe(
        tools["communicate"].description
      );
      expect(tools["communicate"].description).not.toBe(
        tools["resource"].description
      );
    });
  });
});
