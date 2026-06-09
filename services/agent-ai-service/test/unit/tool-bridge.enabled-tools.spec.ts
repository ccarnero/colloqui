import "reflect-metadata";
import { describe, it, expect, mock, beforeEach } from "bun:test";

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
  })),
  jsonSchema: mock((schema: any) => schema),
}));

import { Test } from "@nestjs/testing";
import { ToolBridgeService } from "../../src/modules/tools/tool-bridge.service";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";
import { ToolExecutorService } from "../../src/modules/tools/tool-executor.service";
import { AdapterExecutorService } from "../../src/modules/tools/adapter-executor.service";
import { McpClientService } from "../../src/modules/tools/mcp-client.service";
import type { ToolDef, RuntimeState } from "../../src/modules/tools/tool-definition";

// ── Fixtures ──────────────────────────────────────────────────────────────

const state: RuntimeState = {
  tenantId: "t-1",
  agentId: "a-1",
  executionId: "e-1",
};

const builtinCommunicate: ToolDef = {
  name: "communicate",
  description: "Send a message",
  builtin: true,
  inputSchema: { type: "object", properties: {} },
};

const builtinResource: ToolDef = {
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

const builtinCommunicateRaw = {
  name: "communicate",
  builtin: true,
};

const builtinResourceRaw = {
  name: "resource",
  builtin: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ToolBridgeService — enabled_tools filtering", () => {
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

  beforeEach(async () => {
    mockRegistry = {
      listTools: mock(() => []),
      getToolDefinition: mock(() => undefined),
      hasTool: mock(() => false),
      getTool: mock(() => undefined),
    };
    mockExecutor = {
      executeTool: mock(() =>
        Promise.resolve({ success: true, output: "ok" }),
      ),
    };
    mockAdapterExecutor = {
      execute: mock(() =>
        Promise.resolve({ success: true, output: "adapter-ok" }),
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

  // ────────────────────────────────────────────────────────────────────────
  // toAiSdkToolsForAgent with enabled_tools parameter
  // ────────────────────────────────────────────────────────────────────────

  describe("when enabled_tools is null (all tools enabled)", () => {
    it("should return all declared agent tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate" || name === "resource",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        if (name === "resource") return { definition: builtinResource };
        return undefined;
      });

      // enabled_tools: null → backward compatible, all tools enabled
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw, builtinResourceRaw],
        state,
        null, // enabled_tools
      );

      expect(Object.keys(tools)).toHaveLength(2);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["resource"]).toBeDefined();
    });
  });

  describe("when enabled_tools is undefined (backward compat)", () => {
    it("should return all declared agent tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        return undefined;
      });

      // enabled_tools: undefined → backward compatible, all tools enabled
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw],
        state,
        undefined, // enabled_tools
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["communicate"]).toBeDefined();
    });
  });

  describe("when enabled_tools is an empty array", () => {
    it("should return no tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        return undefined;
      });

      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw],
        state,
        [], // enabled_tools: empty = nothing enabled
      );

      expect(Object.keys(tools)).toHaveLength(0);
    });
  });

  describe("when enabled_tools specifies a subset", () => {
    it("should return only the tools listed in enabled_tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) =>
          name === "communicate" || name === "resource",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        if (name === "resource") return { definition: builtinResource };
        return undefined;
      });

      // Only "communicate" is enabled, "resource" is filtered out
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw, builtinResourceRaw],
        state,
        ["communicate"], // enabled_tools
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["resource"]).toBeUndefined();
    });

    it("should filter out adapter tools not in enabled_tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        return undefined;
      });

      // Adapter tool not in enabled_tools should be filtered
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw, adapterToolRaw],
        state,
        ["communicate"], // only communicate enabled
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["search_tickets"]).toBeUndefined();
    });

    it("should include adapter tools that are in enabled_tools", async () => {
      mockRegistry.hasTool.mockImplementation(() => false);

      const tools = await bridge.toAiSdkToolsForAgent(
        [adapterToolRaw],
        state,
        ["search_tickets"], // adapter tool explicitly enabled
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["search_tickets"]).toBeDefined();
    });
  });

  describe("when enabled_tools contains names not in agent tools", () => {
    it("should not add tools that are not declared in agent tools", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        return undefined;
      });

      // "nonexistent" is in enabled_tools but not in agent tools
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw],
        state,
        ["communicate", "nonexistent"],
      );

      expect(Object.keys(tools)).toHaveLength(1);
      expect(tools["communicate"]).toBeDefined();
      expect(tools["nonexistent"]).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle empty agent tools with enabled_tools", async () => {
      const tools = await bridge.toAiSdkToolsForAgent(
        [],
        state,
        ["communicate"],
      );

      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("should handle malformed enabled_tools gracefully", async () => {
      mockRegistry.hasTool.mockImplementation(
        (name: string) => name === "communicate",
      );
      mockRegistry.getTool.mockImplementation((name: string) => {
        if (name === "communicate") return { definition: builtinCommunicate };
        return undefined;
      });

      // Passing undefined entries in the array should not crash
      const tools = await bridge.toAiSdkToolsForAgent(
        [builtinCommunicateRaw],
        state,
        ["communicate", undefined as any, null as any, 42 as any],
      );

      expect(tools["communicate"]).toBeDefined();
    });
  });
});
