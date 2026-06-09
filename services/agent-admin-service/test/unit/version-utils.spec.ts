import { describe, it, expect } from "bun:test";
import {
  detectBumpType,
  computeSemverLabel,
  computeNextSemver,
  computeSnapshotDiff,
  computeVersionNumber,
} from "../../src/modules/agents/version-utils";
import type { IVersionDiff } from "../../src/modules/agents/version-utils";

// ---------------------------------------------------------------------------
// Helpers – factory functions for building snapshot objects used across tests
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    system_prompt: "You are a helpful assistant.",
    description: "Default agent",
    model_config: {
      llm: {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    tools: [
      { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
    ],
    channels: [{ type: "webchat", id: "ch-1" }],
    knowledge_base_ids: ["kb-1"],
    enabled_mcp_servers: ["mcp-1"],
    input_variables: [{ name: "user_input", type: "string" }],
    output_variables: [{ name: "response", type: "string" }],
    tool_description_overrides: null,
    ...overrides,
  };
}

// ===========================================================================
// detectBumpType
// ===========================================================================

describe("detectBumpType", () => {
  // ---- MAJOR ----------------------------------------------------------------

  it("should return 'major' when LLM provider changes", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({
      model_config: {
        llm: { provider: "anthropic", model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
      },
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("major");
  });

  it("should return 'major' when LLM model changes", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({
      model_config: {
        llm: { provider: "openai", model: "gpt-4o-mini", temperature: 0.7, maxTokens: 4096 },
      },
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("major");
  });

  it("should return 'major' when a tool is removed", () => {
    const prev = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
    });
    const curr = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("major");
  });

  it("should return 'major' when a channel is removed", () => {
    const prev = makeSnapshot({
      channels: [
        { type: "webchat", id: "ch-1" },
        { type: "whatsapp", id: "ch-2" },
      ],
    });
    const curr = makeSnapshot({
      channels: [{ type: "webchat", id: "ch-1" }],
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("major");
  });

  // ---- MINOR ----------------------------------------------------------------

  it("should return 'minor' when a new tool is added", () => {
    const prev = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
    });
    const curr = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("minor");
  });

  it("should return 'minor' when a new channel is added", () => {
    const prev = makeSnapshot({
      channels: [{ type: "webchat", id: "ch-1" }],
    });
    const curr = makeSnapshot({
      channels: [
        { type: "webchat", id: "ch-1" },
        { type: "whatsapp", id: "ch-2" },
      ],
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("minor");
  });

  it("should return 'minor' when a knowledge base is added", () => {
    const prev = makeSnapshot({ knowledge_base_ids: ["kb-1"] });
    const curr = makeSnapshot({ knowledge_base_ids: ["kb-1", "kb-2"] });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("minor");
  });

  it("should return 'minor' when an MCP server is added", () => {
    const prev = makeSnapshot({ enabled_mcp_servers: ["mcp-1"] });
    const curr = makeSnapshot({ enabled_mcp_servers: ["mcp-1", "mcp-2"] });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("minor");
  });

  // ---- PATCH ----------------------------------------------------------------

  it("should return 'patch' when system_prompt changes", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({ system_prompt: "You are a sales assistant." });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("patch");
  });

  it("should return 'patch' when description changes", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({ description: "Updated description" });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("patch");
  });

  it("should return 'patch' when temperature changes", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({
      model_config: {
        llm: { provider: "openai", model: "gpt-4o", temperature: 0.9, maxTokens: 4096 },
      },
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("patch");
  });

  it("should return 'patch' when only tool_description_overrides change", () => {
    const prev = makeSnapshot({ tool_description_overrides: null });
    const curr = makeSnapshot({
      tool_description_overrides: { calendar: "Book meetings with customers" },
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("patch");
  });

  it("should return 'patch' when nothing changes (no-op publish)", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot();

    const result = detectBumpType(prev, curr);

    expect(result).toBe("patch");
  });

  // ---- PRIORITY -------------------------------------------------------------

  it("should prioritize 'major' over 'minor' when both apply", () => {
    // tool removed (major) AND new channel added (minor)
    const prev = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
      channels: [{ type: "webchat", id: "ch-1" }],
    });
    const curr = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
      channels: [
        { type: "webchat", id: "ch-1" },
        { type: "whatsapp", id: "ch-2" },
      ],
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("major");
  });

  it("should prioritize 'minor' over 'patch' when both apply", () => {
    // new tool added (minor) AND system_prompt changed (patch)
    const prev = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
      system_prompt: "Original prompt",
    });
    const curr = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
      system_prompt: "Updated prompt",
    });

    const result = detectBumpType(prev, curr);

    expect(result).toBe("minor");
  });
});

// ===========================================================================
// computeSemverLabel
// ===========================================================================

describe("computeSemverLabel", () => {
  it("should format as 'major.minor.patch'", () => {
    const result = computeSemverLabel(2, 5, 1);

    expect(result).toBe("2.5.1");
  });

  it("should handle zeros correctly '0.0.1'", () => {
    const result = computeSemverLabel(0, 0, 1);

    expect(result).toBe("0.0.1");
  });
});

// ===========================================================================
// computeNextSemver
// ===========================================================================

describe("computeNextSemver", () => {
  it("should bump patch correctly: (1,2,3,'patch') → {1,2,4,'1.2.4'}", () => {
    const result = computeNextSemver(1, 2, 3, "patch");

    expect(result).toEqual({ major: 1, minor: 2, patch: 4, label: "1.2.4" });
  });

  it("should bump minor correctly: (1,2,3,'minor') → {1,3,0,'1.3.0'}", () => {
    const result = computeNextSemver(1, 2, 3, "minor");

    expect(result).toEqual({ major: 1, minor: 3, patch: 0, label: "1.3.0" });
  });

  it("should bump major correctly: (1,2,3,'major') → {2,0,0,'2.0.0'}", () => {
    const result = computeNextSemver(1, 2, 3, "major");

    expect(result).toEqual({ major: 2, minor: 0, patch: 0, label: "2.0.0" });
  });
});

// ===========================================================================
// computeSnapshotDiff
// ===========================================================================

describe("computeSnapshotDiff", () => {
  it("should detect added tools", () => {
    const prev = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
    });
    const curr = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
    });

    const diff: IVersionDiff = computeSnapshotDiff(prev, curr);

    expect(diff.added).toContain("tools[1]");
  });

  it("should detect removed tools", () => {
    const prev = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
        { name: "catalog", adapterRef: { adapterId: "cat-1", endpointId: "search" } },
      ],
    });
    const curr = makeSnapshot({
      tools: [
        { name: "calendar", adapterRef: { adapterId: "cal-1", endpointId: "book" } },
      ],
    });

    const diff: IVersionDiff = computeSnapshotDiff(prev, curr);

    expect(diff.removed).toContain("tools[1]");
  });

  it("should detect modified system_prompt", () => {
    const prev = makeSnapshot({ system_prompt: "Old prompt" });
    const curr = makeSnapshot({ system_prompt: "New prompt" });

    const diff: IVersionDiff = computeSnapshotDiff(prev, curr);

    const modification = diff.modified.find((m) => m.field === "system_prompt");
    expect(modification).toBeDefined();
    expect(modification!.before).toBe("Old prompt");
    expect(modification!.after).toBe("New prompt");
  });

  it("should detect added knowledge_base_ids", () => {
    const prev = makeSnapshot({ knowledge_base_ids: ["kb-1"] });
    const curr = makeSnapshot({ knowledge_base_ids: ["kb-1", "kb-2"] });

    const diff: IVersionDiff = computeSnapshotDiff(prev, curr);

    expect(diff.added).toContain("knowledge_base_ids[1]");
  });

  it("should detect model_config provider change", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({
      model_config: {
        llm: {
          provider: "anthropic",
          model: "gpt-4o",
          temperature: 0.7,
          maxTokens: 4096,
        },
      },
    });

    const diff: IVersionDiff = computeSnapshotDiff(prev, curr);

    const modification = diff.modified.find(
      (m) => m.field === "model_config.llm.provider",
    );
    expect(modification).toBeDefined();
    expect(modification!.before).toBe("openai");
    expect(modification!.after).toBe("anthropic");
  });

  it("should return empty diff for identical snapshots", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot();

    const diff: IVersionDiff = computeSnapshotDiff(prev, curr);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
  });

  it("should handle first publish (previousSnapshot = null) — everything is 'added'", () => {
    const curr = makeSnapshot();

    const diff: IVersionDiff = computeSnapshotDiff(null, curr);

    expect(diff.added.length).toBeGreaterThan(0);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    // All top-level keys should appear as added
    expect(diff.added).toContain("system_prompt");
    expect(diff.added).toContain("model_config");
    expect(diff.added).toContain("tools");
    expect(diff.added).toContain("channels");
  });
});

// ===========================================================================
// computeVersionNumber
// ===========================================================================

describe("computeVersionNumber", () => {
  it("should convert semver to monotonic: (2,3,1) → 20301", () => {
    const result = computeVersionNumber(2, 3, 1);

    expect(result).toBe(20301);
  });

  it("should handle (0,0,1) → 1", () => {
    const result = computeVersionNumber(0, 0, 1);

    expect(result).toBe(1);
  });

  it("should handle (1,0,0) → 10000", () => {
    const result = computeVersionNumber(1, 0, 0);

    expect(result).toBe(10000);
  });
});
