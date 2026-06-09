import { describe, it, expect } from "bun:test";
import {
  catalogSkillToSkillDefinition,
} from "../skill-mapper";
import { SkillMode, type SkillDefinition } from "../skill-definition";

// ---------------------------------------------------------------------------
// BUG-2: Catalog ISkill → SkillDefinition mapping
//
// The function `catalogSkillToSkillDefinition()` does not exist yet.
// These tests will ALL fail with MODULE_NOT_FOUND until:
//   1. `skill-mapper.ts` is created with the exported function
//   2. The function correctly maps the catalog model (ISkill) to the
//      runtime model (SkillDefinition)
// ---------------------------------------------------------------------------

/**
 * Shape of a catalog skill as it arrives in the AI service
 * (from the admin DB or via NATS event).
 *
 * Currently the catalog ISkill does NOT include:
 *   - when_to_use
 *   - priority
 *   - allowed_tools
 *   - mode
 *
 * These will be added by the BUG-2 migration.
 */
interface ICatalogSkill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  color: string;
  trigger_commands: string[];
  files: Array<{ name: string; path: string; type: string; content: string }>;
  metadata: Record<string, unknown>;
  is_active: boolean;
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: string;
  created_at: Date;
  updated_at: Date;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function fullCatalogSkill(overrides: Partial<ICatalogSkill> = {}): ICatalogSkill {
  return {
    id: "skill-1",
    name: "pricing",
    description: "Provides pricing information",
    system_prompt: "You are a pricing expert. Answer questions about pricing.",
    icon: "attach_money",
    color: "#4caf50",
    trigger_commands: ["/pricing", "/cost", "/subscription"],
    files: [],
    metadata: {},
    is_active: true,
    when_to_use: "When the user asks about pricing or subscription costs",
    priority: 5,
    allowed_tools: ["communicate", "search_tickets"],
    mode: "router",
    created_at: new Date("2025-01-01"),
    updated_at: new Date("2025-01-02"),
    ...overrides,
  };
}

function expectedFullSkillDef(): SkillDefinition {
  return {
    id: "skill-1",
    name: "pricing",
    description: "Provides pricing information",
    enabled: true,
    instructions: "You are a pricing expert. Answer questions about pricing.",
    whenToUse: "When the user asks about pricing or subscription costs",
    triggers: ["/pricing", "/cost", "/subscription"],
    allowedTools: ["communicate", "search_tickets"],
    mode: SkillMode.ROUTER,
    priority: 5,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("catalogSkillToSkillDefinition()", () => {
  // =========================================================================
  //  Full mapping
  // =========================================================================

  it("maps all fields correctly (system_prompt → instructions, etc.) (T11)", () => {
    const catalog = fullCatalogSkill();
    const result = catalogSkillToSkillDefinition(catalog);

    // Core identity fields
    expect(result.id).toBe(catalog.id);
    expect(result.name).toBe(catalog.name);
    expect(result.description).toBe(catalog.description);

    // system_prompt → instructions
    expect(result.instructions).toBe(catalog.system_prompt);

    // is_active → enabled
    expect(result.enabled).toBe(catalog.is_active);

    // when_to_use → whenToUse
    expect(result.whenToUse).toBe(catalog.when_to_use);

    // trigger_commands → triggers
    expect(result.triggers).toEqual(catalog.trigger_commands);

    // priority
    expect(result.priority).toBe(catalog.priority);

    // allowed_tools → allowedTools
    expect(result.allowedTools).toEqual(catalog.allowed_tools);

    // mode → SkillMode enum
    expect(result.mode).toBe(SkillMode.ROUTER);
  });

  // =========================================================================
  //  Missing optional fields (should use defaults / be undefined)
  // =========================================================================

  it("handles missing optional fields (uses defaults) (T12)", () => {
    const catalog = fullCatalogSkill({
      when_to_use: undefined,
      priority: undefined,
      allowed_tools: undefined,
      mode: undefined,
    });

    const result = catalogSkillToSkillDefinition(catalog);

    // Optional fields should gracefully map to sensible defaults
    expect(result.whenToUse).toBeUndefined();
    // priority defaults to 0 if missing
    expect(result.priority).toBe(0);
    // allowed_tools defaults to empty array
    expect(result.allowedTools).toEqual([]);
    // mode defaults to undefined (the SkillDefinition treats undefined as "not set")
    expect(result.mode).toBeUndefined();
  });

  // =========================================================================
  //  Empty trigger_commands
  // =========================================================================

  it("handles empty trigger_commands (T13)", () => {
    const catalog = fullCatalogSkill({ trigger_commands: [] });

    const result = catalogSkillToSkillDefinition(catalog);

    expect(result.triggers).toEqual([]);
    // Other fields must still be present
    expect(result.id).toBe("skill-1");
    expect(result.instructions).toBe(catalog.system_prompt);
  });

  // =========================================================================
  //  Mode field mapping
  // =========================================================================

  it("passes mode field correctly for all valid modes (T14)", () => {
    const modes: Array<{
      catalogValue: string;
      expected: SkillMode;
    }> = [
      { catalogValue: "router", expected: SkillMode.ROUTER },
      { catalogValue: "llm_driven", expected: SkillMode.LLM_DRIVEN },
      { catalogValue: "inline", expected: SkillMode.INLINE },
    ];

    for (const { catalogValue, expected } of modes) {
      const catalog = fullCatalogSkill({ mode: catalogValue });
      const result = catalogSkillToSkillDefinition(catalog);
      expect(result.mode).toBe(expected);
    }
  });

  it("passes mode field correctly for inactive skill", () => {
    const catalog = fullCatalogSkill({
      is_active: false,
      mode: "inline",
    });

    const result = catalogSkillToSkillDefinition(catalog);

    expect(result.enabled).toBe(false);
    expect(result.mode).toBe(SkillMode.INLINE);
  });
});
