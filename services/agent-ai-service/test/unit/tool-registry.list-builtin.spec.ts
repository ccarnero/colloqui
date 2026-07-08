import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Stable mock references shared by every Logger instance created inside
// ToolRegistryService.
// ---------------------------------------------------------------------------
const logSpy = mock(() => {});
const warnSpy = mock(() => {});
const errorSpy = mock(() => {});

mock.module("@nestjs/common", () => ({
  Injectable: () => (target: any) => target, // eslint-disable-line @typescript-eslint/no-explicit-any
  Logger: class MockLogger {
    log = logSpy;
    warn = warnSpy;
    error = errorSpy;
    debug = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
    static overrideLogger = mock(() => {});
    constructor(_context?: string) {}
  },
}));

import type { ToolDef } from "../../src/modules/tools/tool-definition";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDefinition(overrides?: Partial<ToolDef>): ToolDef {
  return {
    name: "test-tool",
    description: "A test tool",
    inputSchema: { type: "object" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ToolRegistryService.listBuiltinTools()", () => {
  let service: ToolRegistryService;

  beforeEach(() => {
    service = new ToolRegistryService();
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  // =========================================================================
  //  Happy path
  // =========================================================================
  it("should return only tools with builtin: true", () => {
    service.registerTool(
      makeDefinition({ name: "communicate", builtin: true })
    );
    service.registerTool(makeDefinition({ name: "resource", builtin: true }));
    service.registerTool(
      makeDefinition({ name: "custom-adapter", builtin: false })
    );
    service.registerTool(makeDefinition({ name: "no-flag" })); // builtin undefined

    const builtins = service.listBuiltinTools();

    expect(builtins).toHaveLength(2);
    expect(builtins.map((d) => d.name).sort()).toEqual([
      "communicate",
      "resource",
    ]);
  });

  it("should return an empty array when no builtin tools are registered", () => {
    service.registerTool(makeDefinition({ name: "adapter-a", builtin: false }));
    service.registerTool(makeDefinition({ name: "adapter-b" }));

    const builtins = service.listBuiltinTools();

    expect(builtins).toEqual([]);
  });

  it("should return an empty array when registry is empty", () => {
    const builtins = service.listBuiltinTools();

    expect(builtins).toEqual([]);
  });

  // =========================================================================
  //  Returns ToolDef[] (definitions only, not RegisteredTool)
  // =========================================================================
  it("should return ToolDef objects, not RegisteredTool objects", () => {
    service.registerTool(makeDefinition({ name: "my-builtin", builtin: true }));

    const builtins = service.listBuiltinTools();

    expect(builtins).toHaveLength(1);
    // ToolDef has no `handler` property
    expect(builtins[0]).toEqual(
      makeDefinition({ name: "my-builtin", builtin: true })
    );
    expect((builtins[0] as any).handler).toBeUndefined();
  });

  // =========================================================================
  //  Does not mutate registry
  // =========================================================================
  it("should not affect the registry state when called", () => {
    service.registerTool(makeDefinition({ name: "b1", builtin: true }));
    service.registerTool(makeDefinition({ name: "b2", builtin: true }));
    service.registerTool(makeDefinition({ name: "custom" }));

    const before = service.listTools().length;
    service.listBuiltinTools(); // call
    const after = service.listTools().length;

    expect(before).toBe(after);
  });

  // =========================================================================
  //  Mixed set — only builtins returned
  // =========================================================================
  it("should correctly filter a mixed set of builtin and non-builtin tools", () => {
    const builtins = [
      makeDefinition({
        name: "communicate",
        builtin: true,
        description: "Send messages",
      }),
      makeDefinition({
        name: "resource",
        builtin: true,
        description: "Manage resources",
      }),
    ];
    const adapters = [
      makeDefinition({
        name: "search_tickets",
        builtin: false,
        description: "Search tickets",
      }),
      makeDefinition({ name: "book_calendar", description: "Book calendar" }),
    ];

    for (const def of [...builtins, ...adapters]) {
      service.registerTool(def);
    }

    const result = service.listBuiltinTools();

    expect(result).toHaveLength(2);
    expect(result.every((d) => d.builtin === true)).toBe(true);
    expect(result.find((d) => d.name === "communicate")).toBeDefined();
    expect(result.find((d) => d.name === "resource")).toBeDefined();
    expect(result.find((d) => d.name === "search_tickets")).toBeUndefined();
    expect(result.find((d) => d.name === "book_calendar")).toBeUndefined();
  });

  // =========================================================================
  //  After clear
  // =========================================================================
  it("should return empty array after registry is cleared", () => {
    service.registerTool(makeDefinition({ name: "b1", builtin: true }));
    service.clear();

    const builtins = service.listBuiltinTools();

    expect(builtins).toEqual([]);
  });

  // =========================================================================
  //  Overwritten tool — latest definition wins
  // =========================================================================
  it("should reflect the latest definition after overwriting a builtin tool", () => {
    service.registerTool(
      makeDefinition({ name: "communicate", builtin: true, description: "v1" })
    );
    service.registerTool(
      makeDefinition({ name: "communicate", builtin: true, description: "v2" })
    );

    const builtins = service.listBuiltinTools();

    expect(builtins).toHaveLength(1);
    expect(builtins[0].description).toBe("v2");
  });
});
