import "reflect-metadata";
import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

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
// Mock @nestjs/common Logger for classes that use it directly
// ---------------------------------------------------------------------------
mock.module("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: class MockLogger {
    log = mock(() => {});
    warn = mock(() => {});
    error = mock(() => {});
    debug = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
    static overrideLogger = mock(() => {});
    constructor(_context?: string) {}
  },
}));

// ---------------------------------------------------------------------------
// Mock the ai module (used by toolDefToVercelTool)
// ---------------------------------------------------------------------------
mock.module("ai", () => ({
  jsonSchema: mock((schema: any) => schema),
}));

import type {
  RuntimeState,
  ToolDef,
  ToolHandler,
} from "../../src/modules/tools/tool-definition";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";

// ---------------------------------------------------------------------------
// MemoryClientService mock
// ---------------------------------------------------------------------------
const mockMemoryClient = {
  create: mock(() =>
    Promise.resolve({
      id: "mem-1",
      title: "Test",
      content: "Test content",
      scope: "SESSION",
      kind: "FACT",
      status: "ACTIVE",
      metadata: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })
  ),
  list: mock(() => Promise.resolve({ items: [], total: 0 })),
  search: mock(() => Promise.resolve({ items: [], total: 0 })),
  load: mock(() => Promise.resolve(null)),
  update: mock(() =>
    Promise.resolve({
      id: "mem-1",
      title: "Updated",
      content: "Updated content",
      scope: "SESSION",
      kind: "FACT",
      status: "ACTIVE",
      metadata: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })
  ),
  approve: mock(() =>
    Promise.resolve({
      id: "mem-1",
      title: "Test",
      content: "Test",
      scope: "SESSION",
      kind: "FACT",
      status: "ACTIVE",
      metadata: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })
  ),
  reject: mock(() =>
    Promise.resolve({
      id: "mem-1",
      title: "Test",
      content: "Test",
      scope: "SESSION",
      kind: "FACT",
      status: "REJECTED",
      metadata: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })
  ),
  delete: mock(() => Promise.resolve()),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const state: RuntimeState = {
  tenantId: "t-1",
  agentId: "a-1",
  executionId: "e-1",
  sessionId: "sess-1",
};

// Type for the expected memory tool handler params
interface MemoryHandlerParams {
  action: string;
  [key: string]: unknown;
}

// Expected MEMORY_TOOL_DEF shape
const EXPECTED_MEMORY_TOOL_DEF: ToolDef = {
  name: "memory",
  description: "Store and retrieve conversation data for long-term memory",
  builtin: true,
  readOnly: false,
  maxOutputChars: 16_384,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "list",
          "search",
          "create",
          "get",
          "update",
          "approve",
          "reject",
          "delete",
        ],
        description: "Memory action to perform",
      },
    },
    required: ["action"],
  },
};

// We import the tool def and handler dynamically (they may not exist yet)
let MEMORY_TOOL_DEF: ToolDef | null = null;
let memoryHandler: ToolHandler | null = null;

async function loadMemoryTool() {
  try {
    const mod = await import(
      "../../src/modules/tools/builtin-tools/memory.tool"
    );
    MEMORY_TOOL_DEF = mod.createMemoryToolDef();
    memoryHandler = mod.createMemoryHandler(mockMemoryClient);
  } catch {
    // Module doesn't exist yet — tests will fail with clear message
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Memory builtin tool", () => {
  beforeAll(async () => {
    await loadMemoryTool();
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Tool registration
  // ══════════════════════════════════════════════════════════════════════════

  describe("tool registration", () => {
    it("should provide MEMORY_TOOL_DEF with correct shape", () => {
      expect(MEMORY_TOOL_DEF).not.toBeNull();
      expect(MEMORY_TOOL_DEF!.name).toBe("memory");
      expect(MEMORY_TOOL_DEF!.builtin).toBe(true);
      expect(MEMORY_TOOL_DEF!.inputSchema).toBeDefined();
      expect((MEMORY_TOOL_DEF!.inputSchema as any).properties).toBeDefined();
    });

    it("should be visible via listBuiltinTools() when registered", () => {
      expect(MEMORY_TOOL_DEF).not.toBeNull();
      const registry = new ToolRegistryService();
      registry.registerTool(MEMORY_TOOL_DEF!, memoryHandler!);

      const builtins = registry.listBuiltinTools();
      expect(builtins.map((d) => d.name)).toContain("memory");
    });

    it("should not expose handler via listBuiltinTools()", () => {
      expect(MEMORY_TOOL_DEF).not.toBeNull();
      const registry = new ToolRegistryService();
      registry.registerTool(MEMORY_TOOL_DEF!, memoryHandler!);

      const builtins = registry.listBuiltinTools();
      const memory = builtins.find((d) => d.name === "memory");
      expect(memory).toBeDefined();
      expect((memory as any).handler).toBeUndefined();
    });

    it("should have correct inputSchema with action enum", () => {
      expect(MEMORY_TOOL_DEF).not.toBeNull();
      const schema = MEMORY_TOOL_DEF!.inputSchema as any;
      expect(schema.properties.action).toBeDefined();
      expect(schema.properties.action.type).toBe("string");
      expect(schema.properties.action.enum).toContain("list");
      expect(schema.properties.action.enum).toContain("search");
      expect(schema.properties.action.enum).toContain("create");
      expect(schema.properties.action.enum).toContain("get");
      expect(schema.properties.action.enum).toContain("update");
      expect(schema.properties.action.enum).toContain("approve");
      expect(schema.properties.action.enum).toContain("reject");
      expect(schema.properties.action.enum).toContain("delete");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Handler dispatch — happy path per action
  // ══════════════════════════════════════════════════════════════════════════

  describe("handler dispatch", () => {
    beforeEach(() => {
      mockMemoryClient.create.mockClear();
      mockMemoryClient.list.mockClear();
      mockMemoryClient.search.mockClear();
      mockMemoryClient.load.mockClear();
      mockMemoryClient.update.mockClear();
      mockMemoryClient.approve.mockClear();
      mockMemoryClient.reject.mockClear();
      mockMemoryClient.delete.mockClear();
    });

    it('should call memoryClient.create for action "create" with CreateMemoryInput', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.create.mockResolvedValueOnce({
        id: "mem-new",
        title: "New Memory",
        content: "Memory content",
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        metadata: {},
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const result = await memoryHandler!(
        {
          action: "create",
          scope: "SESSION",
          kind: "FACT",
          title: "New Memory",
          content: "Memory content",
        },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.create).toHaveBeenCalledWith("t-1", {
        scope: "SESSION",
        kind: "FACT",
        title: "New Memory",
        content: "Memory content",
      });
    });

    it('should call memoryClient.list for action "list" with query fields', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.list.mockResolvedValueOnce({
        items: [
          {
            id: "mem-1",
            title: "T1",
            content: "C1",
            scope: "SESSION",
            kind: "FACT",
            status: "ACTIVE",
            metadata: {},
            createdAt: "",
            updatedAt: "",
          },
        ],
        total: 1,
      });

      const result = await memoryHandler!(
        {
          action: "list",
          scope: "SESSION",
          kind: "FACT",
          status: "ACTIVE",
          limit: 20,
        },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.list).toHaveBeenCalledWith("t-1", {
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        limit: 20,
      });
    });

    it('should call memoryClient.search for action "search" with search text', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.search.mockResolvedValueOnce({
        items: [
          {
            id: "mem-1",
            title: "Found",
            content: "Result",
            scope: "SESSION",
            kind: "FACT",
            status: "ACTIVE",
            metadata: {},
            createdAt: "",
            updatedAt: "",
          },
        ],
        total: 1,
      });

      const result = await memoryHandler!(
        {
          action: "search",
          search: "test query",
          limit: 5,
        },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.search).toHaveBeenCalledWith(
        "t-1",
        "test query",
        5
      );
    });

    it('should call memoryClient.load for action "get" with the correct id', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.load.mockResolvedValueOnce({
        id: "mem-123",
        title: "Found Memory",
        content: "Content",
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        metadata: {},
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const result = await memoryHandler!(
        { action: "get", id: "mem-123" },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.load).toHaveBeenCalledWith("t-1", "mem-123");
    });

    it('should call memoryClient.update for action "update" with patch fields', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.update.mockResolvedValueOnce({
        id: "mem-1",
        title: "Updated Title",
        content: "Updated content",
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        metadata: {},
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const result = await memoryHandler!(
        {
          action: "update",
          id: "mem-1",
          title: "Updated Title",
          content: "Updated content",
        },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.update).toHaveBeenCalledWith("t-1", "mem-1", {
        title: "Updated Title",
        content: "Updated content",
      });
    });

    it('should call memoryClient.approve for action "approve" with id', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.approve.mockResolvedValueOnce({
        id: "mem-1",
        title: "T",
        content: "C",
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        metadata: {},
        createdAt: "",
        updatedAt: "",
      });

      const result = await memoryHandler!(
        { action: "approve", id: "mem-1" },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.approve).toHaveBeenCalledWith("t-1", "mem-1");
    });

    it('should call memoryClient.reject for action "reject" with id', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.reject.mockResolvedValueOnce({
        id: "mem-1",
        title: "T",
        content: "C",
        scope: "SESSION",
        kind: "FACT",
        status: "REJECTED",
        metadata: {},
        createdAt: "",
        updatedAt: "",
      });

      const result = await memoryHandler!(
        { action: "reject", id: "mem-1" },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.reject).toHaveBeenCalledWith("t-1", "mem-1");
    });

    it('should call memoryClient.delete for action "delete" with id', async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.delete.mockResolvedValueOnce(undefined);

      const result = await memoryHandler!(
        { action: "delete", id: "mem-1" },
        state
      );

      expect(result.success).toBe(true);
      expect(mockMemoryClient.delete).toHaveBeenCalledWith("t-1", "mem-1");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Error handling
  // ══════════════════════════════════════════════════════════════════════════

  describe("error handling", () => {
    it("should return error when action is missing", async () => {
      expect(memoryHandler).not.toBeNull();
      const result = await memoryHandler!({}, state);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error for unknown action", async () => {
      expect(memoryHandler).not.toBeNull();
      const result = await memoryHandler!({ action: "fly" }, state);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown action");
    });

    it('should return error when required params are missing for action "create"', async () => {
      expect(memoryHandler).not.toBeNull();
      const result = await memoryHandler!({ action: "create" }, state);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error when id is missing for action "get"', async () => {
      expect(memoryHandler).not.toBeNull();
      const result = await memoryHandler!({ action: "get" }, state);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error when id is missing for action "update"', async () => {
      expect(memoryHandler).not.toBeNull();
      const result = await memoryHandler!(
        { action: "update", title: "New" },
        state
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should propagate upstream 4xx errors from MemoryClientService", async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.list.mockRejectedValueOnce(
        new Error("Memory list failed: 400")
      );

      const result = await memoryHandler!({ action: "list" }, state);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Memory list failed");
    });

    it("should propagate upstream 5xx errors from MemoryClientService", async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.create.mockRejectedValueOnce(
        new Error("Memory create failed: 503")
      );

      const result = await memoryHandler!(
        {
          action: "create",
          scope: "SESSION",
          kind: "FACT",
          title: "X",
          content: "Y",
        },
        state
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Memory create failed");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  RuntimeState plumbed correctly
  // ══════════════════════════════════════════════════════════════════════════

  describe("RuntimeState propagation", () => {
    beforeEach(() => {
      mockMemoryClient.create.mockClear();
      mockMemoryClient.list.mockClear();
      mockMemoryClient.update.mockClear();
      mockMemoryClient.load.mockClear();
    });

    it("should pass tenantId from RuntimeState to MemoryClientService methods", async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.load.mockResolvedValueOnce(null);

      await memoryHandler!(
        { action: "get", id: "mem-1" },
        { ...state, tenantId: "custom-tenant" }
      );

      expect(mockMemoryClient.load).toHaveBeenCalledWith(
        "custom-tenant",
        "mem-1"
      );
    });

    it("should pass sessionId when available in RuntimeState", async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.create.mockResolvedValueOnce({
        id: "mem-1",
        title: "T",
        content: "C",
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        metadata: {},
        createdAt: "",
        updatedAt: "",
      });

      await memoryHandler!(
        {
          action: "create",
          scope: "SESSION",
          kind: "FACT",
          title: "T",
          content: "C",
          sessionId: "sess-1",
        },
        { ...state, sessionId: "sess-1" }
      );

      expect(mockMemoryClient.create).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({ sessionId: "sess-1" })
      );
    });

    it("should pass userId when available in RuntimeState", async () => {
      expect(memoryHandler).not.toBeNull();
      mockMemoryClient.create.mockResolvedValueOnce({
        id: "mem-1",
        title: "T",
        content: "C",
        scope: "SESSION",
        kind: "FACT",
        status: "ACTIVE",
        metadata: {},
        createdAt: "",
        updatedAt: "",
      });

      await memoryHandler!(
        {
          action: "create",
          scope: "SESSION",
          kind: "FACT",
          title: "T",
          content: "C",
          userId: "user-1",
        },
        { ...state, userId: "user-1" }
      );

      expect(mockMemoryClient.create).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({ userId: "user-1" })
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Output truncation
  // ══════════════════════════════════════════════════════════════════════════

  describe("output truncation", () => {
    it("should truncate list/search output to maxOutputChars (16384)", async () => {
      expect(memoryHandler).not.toBeNull();
      const longContent = "x".repeat(20000);
      mockMemoryClient.list.mockResolvedValueOnce({
        items: [
          {
            id: "mem-1",
            title: "Long memory",
            content: longContent,
            scope: "SESSION",
            kind: "FACT",
            status: "ACTIVE",
            metadata: {},
            createdAt: "",
            updatedAt: "",
          },
        ],
        total: 1,
      });

      const result = await memoryHandler!({ action: "list" }, state);

      expect(result.success).toBe(true);
      const output = result.output as any;
      expect(output).toBeDefined();
      // The handler should truncate the output
      const outputStr =
        typeof output === "string" ? output : JSON.stringify(output);
      expect(outputStr.length).toBeLessThanOrEqual(16384 + 2000); // allow some overhead
    });
  });
});
