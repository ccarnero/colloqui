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
    inputSchema: opts.inputSchema,
    execute: opts.execute,
  })),
  jsonSchema: mock((schema: any) => schema),
}));

import { Test } from "@nestjs/testing";
import { AdapterExecutorService } from "../../src/modules/tools/adapter-executor.service";
import { McpClientService } from "../../src/modules/tools/mcp-client.service";
import { ToolBridgeService } from "../../src/modules/tools/tool-bridge.service";
import type { ToolExecutionContext } from "../../src/modules/tools/tool-definition";
import { ToolExecutorService } from "../../src/modules/tools/tool-executor.service";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";

// ---------------------------------------------------------------------------
// agent-mcp-tool-naming.md T01 (Option B — global separator change).
// Regression class for the exact incident: colon-namespaced MCP tool keys
// violate OpenAI's `^[a-zA-Z0-9_-]+$` tool-name pattern.
// ---------------------------------------------------------------------------

const state: ToolExecutionContext = {
  tenantId: "t-1",
  agentId: "a-1",
  executionId: "e-1",
};

describe("ToolBridgeService — MCP tool naming (T01, Option B)", () => {
  let bridge: ToolBridgeService;
  let mockRegistry: {
    listTools: ReturnType<typeof mock>;
    getToolDefinition: ReturnType<typeof mock>;
    hasTool: ReturnType<typeof mock>;
    getTool: ReturnType<typeof mock>;
  };
  let mockExecutor: { executeTool: ReturnType<typeof mock> };
  let mockAdapterExecutor: { execute: ReturnType<typeof mock> };
  let mockMcpClient: {
    connect: ReturnType<typeof mock>;
    getTools: ReturnType<typeof mock>;
    getAllTools: ReturnType<typeof mock>;
    getConnectedServers: ReturnType<typeof mock>;
    getServerId: ReturnType<typeof mock>;
    disconnect: ReturnType<typeof mock>;
    disconnectAll: ReturnType<typeof mock>;
  };

  let origFilteringEnabled: string | undefined;
  let origOverridesEnabled: string | undefined;

  beforeEach(async () => {
    origFilteringEnabled = process.env.AGENT_MCP_TOOL_FILTERING_ENABLED;
    origOverridesEnabled = process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED;

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
      getServerId: mock(() => "server-id"),
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
    if (origFilteringEnabled === undefined) {
      delete process.env.AGENT_MCP_TOOL_FILTERING_ENABLED;
    } else {
      process.env.AGENT_MCP_TOOL_FILTERING_ENABLED = origFilteringEnabled;
    }
    if (origOverridesEnabled === undefined) {
      delete process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED;
    } else {
      process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED =
        origOverridesEnabled;
    }
  });

  const mkTool = (description = "A tool") => ({
    type: "function" as const,
    description,
    inputSchema: { type: "object", properties: {} },
    execute: mock(() => Promise.resolve("ok")),
  });

  describe("filteringEnabled=true — merged key always matches ^[a-zA-Z0-9_-]+$", () => {
    beforeEach(() => {
      process.env.AGENT_MCP_TOOL_FILTERING_ENABLED = "true";
    });

    it("sanitizes a plain server/tool pair (regression: OpenAI rejects a colon)", async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({ list_issues: mkTool() })
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null);

      const keys = Object.keys(tools);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe("github-mcp__list_issues");
      expect(keys[0]).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it("sanitizes a server name shaped like the live incident offender (deepwiki-shaped, contains illegal characters)", async () => {
      // Exact incident class from the SPEC's motivating incident — a
      // server/tool name pair containing characters outside
      // ^[a-zA-Z0-9_-]+$ today (space/dot), mirroring `deepwiki`.
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "deep.wiki server",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({ "search wiki": mkTool() })
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null);

      const keys = Object.keys(tools);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^[a-zA-Z0-9_-]+$/);
    });
  });

  describe("filteringEnabled=false — unchanged raw toolName behavior (Constraints: out of scope for T01)", () => {
    beforeEach(() => {
      delete process.env.AGENT_MCP_TOOL_FILTERING_ENABLED;
    });

    it("keys the merged tool by raw toolName, not the sanitized/namespaced form", async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({ list_issues: mkTool() })
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null);

      expect(Object.keys(tools)).toEqual(["list_issues"]);
    });

    it("still lets an agent-defined tool of the same raw name take precedence (no overwriting)", async () => {
      mockRegistry.hasTool.mockImplementation(() => true);
      mockRegistry.getTool.mockImplementation(() => ({
        definition: {
          name: "list_issues",
          description: "Agent-defined version",
          inputSchema: { type: "object", properties: {} },
        },
      }));
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({ list_issues: mkTool("MCP version") })
      );

      const tools = await bridge.toAiSdkToolsForAgent(
        [{ name: "list_issues", builtin: false }],
        state,
        null,
        null
      );

      expect(tools["list_issues"].description).toBe("Agent-defined version");
    });
  });

  describe("collision handling — two addressing keys that sanitize to the same string", () => {
    beforeEach(() => {
      process.env.AGENT_MCP_TOOL_FILTERING_ENABLED = "true";
    });

    it("keeps both entries present under distinct keys instead of silently overwriting either", async () => {
      // "srv.a" (dot) and "srv a" (space) are distinct addressing keys that
      // both strip to the SAME sanitized string "srva__tool" — force an
      // actual collision by using two servers whose sanitized names match.
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "srv.a",
        "srv a",
      ]);
      mockMcpClient.getTools.mockImplementation((serverName: string) => {
        if (serverName === "srv.a") {
          return Promise.resolve({ tool: mkTool("from srv.a") });
        }
        return Promise.resolve({ tool: mkTool("from srv a") });
      });

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null);

      const keys = Object.keys(tools);
      expect(keys).toHaveLength(2);
      expect(keys).toContain("srva__tool");
      // The second entry is disambiguated, not dropped.
      const disambiguated = keys.find((k) => k !== "srva__tool");
      expect(disambiguated).toMatch(/^srva__tool__[0-9a-f]{6}$/);
      // Both descriptions are reachable — neither call site's tool vanished.
      const descriptions = keys.map((k) => tools[k].description).sort();
      expect(descriptions).toEqual(["from srv a", "from srv.a"]);
    });
  });

  describe("toolDescriptionOverrides — resolves via the sanitized key (single global identity, no legacy form)", () => {
    beforeEach(() => {
      process.env.AGENT_MCP_TOOL_FILTERING_ENABLED = "true";
      process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED = "true";
    });

    it("applies an override keyed in the sanitized form", async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({ list_issues: mkTool("default description") })
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null, {
        "github-mcp__list_issues": "sanitized-form override",
      });

      expect(tools["github-mcp__list_issues"].description).toBe(
        "sanitized-form override"
      );
    });

    it("does NOT apply an override keyed in the pre-T01 colon-joined form (no legacy fallback)", async () => {
      // T01's measured live migration surface was 0 colon-keyed entries on
      // the dev tenant, so Option B removed the legacy read path entirely
      // (single global identity, no sunset debt).
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({ list_issues: mkTool("default description") })
      );

      const tools = await bridge.toAiSdkToolsForAgent([], state, null, null, {
        "github-mcp:list_issues": "colon-form override — must be ignored",
      });

      expect(tools["github-mcp__list_issues"]).toBeDefined();
      expect(tools["github-mcp__list_issues"].description).toBe(
        "default description"
      );
    });
  });

  describe("existing mcp-connections.md §3/§4 behavior stays green (no loosened assertions)", () => {
    beforeEach(() => {
      process.env.AGENT_MCP_TOOL_FILTERING_ENABLED = "true";
    });

    it("still honors the per-server enabledMcpTools allowlist with the new key shape", async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => [
        "github-mcp",
      ]);
      mockMcpClient.getTools.mockImplementation(() =>
        Promise.resolve({
          list_issues: mkTool(),
          delete_repo: mkTool(),
        })
      );

      const tools = await bridge.toAiSdkToolsForAgent(
        [],
        state,
        null,
        null,
        null,
        { "github-mcp": ["list_issues"] }
      );

      expect(Object.keys(tools)).toEqual(["github-mcp__list_issues"]);
    });
  });
});
