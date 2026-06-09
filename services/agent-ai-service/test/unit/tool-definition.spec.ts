import "reflect-metadata";
import { describe, it, expect, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock the ai module — jsonSchema used by toolDefToVercelTool
// ---------------------------------------------------------------------------
mock.module("ai", () => ({
  jsonSchema: mock((schema: any) => schema),
}));

import {
  toolDefToVercelTool,
} from "../../src/modules/tools/tool-definition";
import type { ToolDef, RuntimeState } from "../../src/modules/tools/tool-definition";

// ══════════════════════════════════════════════════════════════════════════
//  RuntimeState — extended shape
// ══════════════════════════════════════════════════════════════════════════

describe("RuntimeState", () => {
  it("should allow tenantId, agentId, executionId as required fields", () => {
    const state: RuntimeState = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
    };

    expect(state.tenantId).toBe("t-1");
    expect(state.agentId).toBe("a-1");
    expect(state.executionId).toBe("e-1");
  });

  it("should allow optional sessionId", () => {
    const state: RuntimeState = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
      sessionId: "sess-1",
    };

    expect(state.sessionId).toBe("sess-1");
  });

  it("should allow optional userId", () => {
    const state: RuntimeState = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
      userId: "user-1",
    };

    expect(state.userId).toBe("user-1");
  });

  it("should allow both sessionId and userId together", () => {
    const state: RuntimeState = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
      sessionId: "sess-1",
      userId: "user-1",
    };

    expect(state.sessionId).toBe("sess-1");
    expect(state.userId).toBe("user-1");
  });

  it("should allow userId without sessionId", () => {
    const state: RuntimeState = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
      userId: "user-1",
    };

    expect(state.userId).toBe("user-1");
    expect(state.sessionId).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  toolDefToVercelTool
// ══════════════════════════════════════════════════════════════════════════

describe("toolDefToVercelTool", () => {
  it("should convert a ToolDef to a Vercel AI SDK tool with description and inputSchema", () => {
    const def: ToolDef = {
      name: "calculator",
      description: "Evaluate math expressions",
      inputSchema: {
        type: "object",
        properties: {
          expression: { type: "string" },
        },
        required: ["expression"],
      },
    };

    const tool = toolDefToVercelTool(def);

    expect(tool.description).toBe("Evaluate math expressions");
    expect(tool.inputSchema).toEqual(def.inputSchema);
  });

  it("should work with builtin tools", () => {
    const def: ToolDef = {
      name: "memory",
      description: "Store and retrieve conversation data",
      builtin: true,
      inputSchema: { type: "object", properties: {} },
    };

    const tool = toolDefToVercelTool(def);

    expect(tool.description).toBe("Store and retrieve conversation data");
    expect(tool.inputSchema).toBeDefined();
  });

  it("should work with adapter tools", () => {
    const def: ToolDef = {
      name: "search_tickets",
      description: "Search support tickets",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      adapterRef: { adapterId: "zendesk", endpointId: "search" },
    };

    const tool = toolDefToVercelTool(def);

    expect(tool.description).toBe("Search support tickets");
    expect(tool.inputSchema).toBeDefined();
  });

  it("should handle empty inputSchema gracefully", () => {
    const def: ToolDef = {
      name: "no_params",
      description: "Tool with no parameters",
      inputSchema: { type: "object", properties: {} },
    };

    const tool = toolDefToVercelTool(def);

    expect(tool.description).toBe("Tool with no parameters");
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
  });
});
