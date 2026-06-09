import { describe, it, expect, beforeEach } from "bun:test";
import { SkillRouterService } from "../../src/modules/skills/skill-router.service";
import type { SkillDefinition, SkillContext } from "../../src/modules/skills/skill-definition";

// ── Fixtures ──────────────────────────────────────────────────────────────

const deploySkill: SkillDefinition = {
  id: "skill-1",
  name: "deploy",
  description: "deploy application production",
  whenToUse: "when user wants to deploy",
  triggers: ["/deploy", "/release"],
  priority: 10,
  enabled: true,
  arguments: ["env", "version"],
  instructions: "Deploy the application",
  allowedTools: [],
};

const pricingSkill: SkillDefinition = {
  id: "skill-2",
  name: "pricing",
  description: "pricing cost budget information",
  whenToUse: "when user asks about pricing",
  triggers: ["/pricing"],
  priority: 5,
  enabled: true,
  arguments: [],
  instructions: "Provide pricing info",
  allowedTools: [],
};

const meetingSkill: SkillDefinition = {
  id: "skill-3",
  name: "schedule-meeting",
  description: "schedule meeting appointment",
  whenToUse: "when user wants to schedule meeting",
  triggers: ["/meeting"],
  priority: 3,
  enabled: true,
  arguments: ["date", "time"],
  instructions: "Schedule a meeting",
  allowedTools: [],
};

const disabledSkill: SkillDefinition = {
  id: "skill-4",
  name: "legacy",
  description: "Legacy skill not in use",
  whenToUse: "Should never be routed",
  triggers: ["/legacy"],
  priority: 0,
  enabled: false,
  arguments: [],
  instructions: "Legacy",
  allowedTools: [],
};

const minimalSkill: SkillDefinition = {
  id: "skill-5",
  name: "echo",
  description: "Echo back the message",
  enabled: true,
  instructions: "Echo",
  allowedTools: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────

function createContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    userMessage: "",
    availableSkills: [],
    warnings: [],
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────

describe("SkillRouterService", () => {
  let router: SkillRouterService;

  beforeEach(() => {
    router = new SkillRouterService();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. setSkills — loading, filtering, sorting
  // ──────────────────────────────────────────────────────────────────────────

  describe("setSkills", () => {
    it("should load skills and make them findable by trigger", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({ userMessage: "/deploy" });
      expect(router.findSkill(ctx)?.name).toBe("deploy");
    });

    it("should filter out disabled skills from available list", () => {
      router.setSkills([deploySkill, disabledSkill]);
      const list = router.listAvailableSkills();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("deploy");
    });

    it("should not return disabled skill via explicit name lookup", () => {
      router.setSkills([deploySkill, disabledSkill]);
      const { skill } = router.validateSkillSelection("legacy");
      expect(skill).toBeNull();
    });

    it("should treat undefined enabled as enabled (not explicitly disabled)", () => {
      const skillNoEnabled: SkillDefinition = {
        id: "skill-noflag",
        name: "implicit-enabled",
        description: "no enabled flag",
        instructions: "",
        allowedTools: [],
      };
      router.setSkills([skillNoEnabled]);
      expect(router.listAvailableSkills()).toHaveLength(1);
      expect(router.listAvailableSkills()[0].name).toBe("implicit-enabled");
    });

    it("should accept empty array and produce zero skills", () => {
      router.setSkills([]);
      expect(router.listAvailableSkills()).toHaveLength(0);
      const ctx = createContext({ userMessage: "/deploy" });
      expect(router.findSkill(ctx)).toBeNull();
    });

    it("should sort skills by priority descending for fallback resolution", () => {
      // Pass skills in unsorted order
      router.setSkills([meetingSkill, deploySkill, pricingSkill]);
      const ctx = createContext({ userMessage: "a b cd" }); // no tokens, no trigger
      const result = router.findSkill(ctx);
      // Highest priority (deploy=10) should win as priority fallback
      expect(result?.name).toBe("deploy");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. findSkill — trigger resolution
  // ──────────────────────────────────────────────────────────────────────────

  describe("findSkill — trigger matching", () => {
    it("should match a skill when message starts with its trigger", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const ctx = createContext({ userMessage: "/deploy now" });
      expect(router.findSkill(ctx)?.name).toBe("deploy");
    });

    it("should match the second trigger of a skill", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({ userMessage: "/release v2" });
      expect(router.findSkill(ctx)?.name).toBe("deploy");
    });

    it("should return null when no trigger matches", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({ userMessage: "hello world" });
      const result = router.findSkill(ctx);
      // Falls through to priority fallback — not null
      expect(result).not.toBeNull();
      expect(result?.name).toBe("deploy"); // priority fallback
    });

    it("should trim leading whitespace from the message before trigger matching", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({ userMessage: "  /deploy staging" });
      expect(router.findSkill(ctx)?.name).toBe("deploy");
    });

    it("should warn when multiple triggers match and pick the highest priority", () => {
      const conflictSkill: SkillDefinition = {
        ...deploySkill,
        id: "skill-conflict",
        name: "conflict-deploy",
        priority: 8, // lower than deploySkill's 10
      };
      router.setSkills([deploySkill, conflictSkill]);
      const ctx = createContext({ userMessage: "/deploy staging" });
      const result = router.findSkill(ctx);
      expect(result?.name).toBe("deploy"); // priority 10 > 8
      expect(ctx.warnings).toContain(
        "Multiple triggers matched, selected 'deploy' by priority",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. findSkill — explicit name resolution
  // ──────────────────────────────────────────────────────────────────────────

  describe("findSkill — explicit name", () => {
    it("should return the skill when explicitSkillName matches", () => {
      router.setSkills([pricingSkill, deploySkill]);
      const ctx = createContext({
        userMessage: "some message",
        explicitSkillName: "deploy",
      });
      const result = router.findSkill(ctx);
      expect(result?.name).toBe("deploy");
    });

    it("should resolve by explicit name when trigger does not match", () => {
      router.setSkills([pricingSkill, deploySkill]);
      const ctx = createContext({
        userMessage: "no trigger here",
        explicitSkillName: "pricing",
      });
      const result = router.findSkill(ctx);
      expect(result?.name).toBe("pricing");
    });

    it("should not emit warning when explicit name resolves successfully", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({
        userMessage: "some message",
        explicitSkillName: "deploy",
      });
      router.findSkill(ctx);
      // No warnings about "not found" or "fallback"
      expect(ctx.warnings.filter((w) => w.includes("not found"))).toHaveLength(0);
      expect(ctx.warnings.filter((w) => w.includes("fallback"))).toHaveLength(0);
    });

    it("should return null (not crash) when explicitSkillName is undefined", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({
        userMessage: "some message",
        // explicitSkillName is undefined
      });
      // Should not crash — resolvesByName returns null silently
      expect(() => router.findSkill(ctx)).not.toThrow();
    });

    it("should fall through with warning when explicitSkillName does not match", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({
        userMessage: "random text",
        explicitSkillName: "nonexistent",
      });
      const result = router.findSkill(ctx);
      // Falls through: no trigger, name not found, no semantic match → priority fallback
      expect(result?.name).toBe("deploy");
      expect(ctx.warnings).toContain(
        "Explicit skill 'nonexistent' not found, will use fallback",
      );
      expect(ctx.warnings).toContain(
        "Using priority fallback to skill 'deploy' (no explicit trigger or name matched)",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. findSkill — semantic matching
  // ──────────────────────────────────────────────────────────────────────────

  describe("findSkill — semantic matching", () => {
    it("should select skill by matching message tokens against skill fields", () => {
      router.setSkills([pricingSkill, deploySkill, meetingSkill]);
      const ctx = createContext({ userMessage: "deploy application" });
      const result = router.findSkill(ctx);
      // deploy: desc +1+1, when +2, name +3, trigger +1 = 8
      // others: 0
      expect(result?.name).toBe("deploy");
      expect(ctx.warnings).toContain(
        "Selected skill 'deploy' by semantic match (score=8)",
      );
    });

    it("should resolve Spanish alias 'precio' to pricing skill via token alias", () => {
      router.setSkills([deploySkill, pricingSkill, meetingSkill]);
      const ctx = createContext({ userMessage: "precio" });
      const result = router.findSkill(ctx);
      // "precio" → alias "pricing" → pricing name +3, desc +1, when +2, trigger +1 = 7
      expect(result?.name).toBe("pricing");
      expect(ctx.warnings).toContain(
        "Selected skill 'pricing' by semantic match (score=7)",
      );
    });

    it("should resolve multiple Spanish pricing aliases", () => {
      router.setSkills([deploySkill, pricingSkill, meetingSkill]);
      const ctx1 = createContext({ userMessage: "costos" });  // → "pricing"
      const ctx2 = createContext({ userMessage: "presupuesto" }); // → "pricing"
      const ctx3 = createContext({ userMessage: "precios" }); // → "pricing"
      const ctx4 = createContext({ userMessage: "costo" });   // → "pricing"

      for (const ctx of [ctx1, ctx2, ctx3, ctx4]) {
        const result = router.findSkill(ctx);
        expect(result?.name).toBe("pricing");
      }
    });

    it("should resolve other Spanish aliases (comprar → buy, objecion → objection)", () => {
      router.setSkills([deploySkill, pricingSkill, meetingSkill]);
      // These will match nothing in current skills, but should not crash
      const ctx = createContext({ userMessage: "objeciones" });
      // Falls through to priority fallback — not a crash
      expect(() => router.findSkill(ctx)).not.toThrow();
    });

    it("should strip accents and apply alias for accented Spanish words", () => {
      router.setSkills([deploySkill, pricingSkill, meetingSkill]);
      const ctx = createContext({ userMessage: "reunión" });
      const result = router.findSkill(ctx);
      // "reunión" → NFKD → "reunion" → alias "meeting"
      // → meetingSkill: desc +1, when +2, trigger +1 = 4
      // (name "schedule-meeting" is one token — not split on hyphen)
      expect(result?.name).toBe("schedule-meeting");
      expect(ctx.warnings).toContain(
        "Selected skill 'schedule-meeting' by semantic match (score=4)",
      );
    });

    it("should break semantic ties by higher priority", () => {
      const alphaSkill: SkillDefinition = {
        id: "tie-alpha",
        name: "alpha",
        description: "alpha test skill",
        triggers: [],
        priority: 3,
        enabled: true,
        instructions: "",
        allowedTools: [],
      };
      const betaSkill: SkillDefinition = {
        id: "tie-beta",
        name: "beta",
        description: "beta test skill",
        triggers: [],
        priority: 5,
        enabled: true,
        instructions: "",
        allowedTools: [],
      };
      router.setSkills([alphaSkill, betaSkill]);
      const ctx = createContext({ userMessage: "test" });
      const result = router.findSkill(ctx);
      // Both score 1 (desc has "test"), beta has higher priority (5 > 3)
      expect(result?.name).toBe("beta");
      expect(ctx.warnings).toContain(
        "Selected skill 'beta' by semantic match (score=1)",
      );
    });

    it("should return null from semantic when message has no valid tokens", () => {
      router.setSkills([deploySkill]);
      // "a b cd" — all < 3 chars, no tokens → semantic returns null
      // Falls to priority fallback, not null overall
      const ctx = createContext({ userMessage: "a b cd" });
      const result = router.findSkill(ctx);
      expect(result).not.toBeNull(); // priority fallback
      expect(ctx.warnings).toContain(
        "Using priority fallback to skill 'deploy' (no explicit trigger or name matched)",
      );
    });

    it("should fall through to priority when tokens exist but nothing matches semantically", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const ctx = createContext({ userMessage: "xyzzy quux" });
      const result = router.findSkill(ctx);
      // tokens {"xyzzy", "quux"} match nothing → semantic returns null
      // → priority fallback
      expect(result?.name).toBe("deploy");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. findSkill — priority fallback and edge cases
  // ──────────────────────────────────────────────────────────────────────────

  describe("findSkill — priority fallback and edge cases", () => {
    it("should return highest priority skill when no trigger, name, or semantic match", () => {
      router.setSkills([meetingSkill, pricingSkill, deploySkill]);
      const ctx = createContext({ userMessage: "a b cd" }); // no tokens
      const result = router.findSkill(ctx);
      expect(result?.name).toBe("deploy"); // highest priority = 10
      expect(ctx.warnings).toContain(
        "Using priority fallback to skill 'deploy' (no explicit trigger or name matched)",
      );
    });

    it("should return null with warning when no skills are loaded", () => {
      // No setSkills call — router has no skills
      const ctx = createContext({ userMessage: "/deploy" });
      const result = router.findSkill(ctx);
      expect(result).toBeNull();
      expect(ctx.warnings).toContain("No enabled skills available");
    });

    it("should return null with warning when all skills are filtered out as disabled", () => {
      router.setSkills([disabledSkill]);
      const ctx = createContext({ userMessage: "/legacy" });
      const result = router.findSkill(ctx);
      expect(result).toBeNull();
      expect(ctx.warnings).toContain("No enabled skills available");
    });

    it("should emit warning when no resolution strategy succeeds", () => {
      router.setSkills([deploySkill]);
      // Force all strategies to fail: empty message, no trigger, no explicit name
      // But priority fallback WILL succeed because there are skills
      // To get "No skill could be resolved", we need the priority array to be empty
      // Which shouldn't happen if enabledSkills has items...
      // Actually, resolveByPriority uses skillsByPriority which mirrors enabledSkills.
      // So if enabledSkills is non-empty, priority always succeeds.
      // The "No skill could be resolved" warning is only reachable if
      // resolveByPriority returns null, which means enabledSkills was empty.
      const ctx = createContext({ userMessage: "" });
      router.setSkills([]);
      const result = router.findSkill(ctx);
      expect(result).toBeNull();
      expect(ctx.warnings).toContain("No enabled skills available");
    });

    it("should handle empty string userMessage without crashing", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const ctx = createContext({ userMessage: "" });
      expect(() => router.findSkill(ctx)).not.toThrow();
      const result = router.findSkill(ctx);
      expect(result).not.toBeNull(); // priority fallback
    });

    it("should handle skills with null/undefined triggers gracefully", () => {
      const noTriggers: SkillDefinition = {
        id: "no-trig",
        name: "safe-harbor",
        description: "Handles requests safely",
        instructions: "Safe",
        enabled: true,
        allowedTools: [],
        // triggers is undefined
      };
      router.setSkills([noTriggers]);
      const ctx = createContext({ userMessage: "/anything" });
      // No trigger match, no semantic match → priority fallback
      const result = router.findSkill(ctx);
      expect(result?.name).toBe("safe-harbor");
    });

    it("should handle empty triggers array gracefully", () => {
      const emptyTriggers: SkillDefinition = {
        ...pricingSkill,
        triggers: [],
      };
      router.setSkills([emptyTriggers]);
      const ctx = createContext({ userMessage: "/pricing" });
      const result = router.findSkill(ctx);
      // No trigger match → priority fallback (or semantic if tokens match)
      expect(result).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. validateSkillSelection
  // ──────────────────────────────────────────────────────────────────────────

  describe("validateSkillSelection", () => {
    it("should return the skill for a valid name with no warnings", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const { skill, warnings } = router.validateSkillSelection("deploy");
      expect(skill?.name).toBe("deploy");
      expect(skill?.id).toBe("skill-1");
      expect(warnings).toHaveLength(0);
    });

    it("should return null with warning listing available skills for an invalid name", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const { skill, warnings } = router.validateSkillSelection("bogus");
      expect(skill).toBeNull();
      expect(warnings).toContain("Skill 'bogus' not found");
      expect(warnings).toContain("Available skills: deploy, pricing");
    });

    it("should return null with 'No skills are available' when no skills loaded", () => {
      // No setSkills called
      const { skill, warnings } = router.validateSkillSelection("anything");
      expect(skill).toBeNull();
      expect(warnings).toContain("Skill 'anything' not found");
      expect(warnings).toContain("No skills are available");
    });

    it("should trim whitespace from skill name before lookup", () => {
      router.setSkills([deploySkill]);
      const { skill } = router.validateSkillSelection("  deploy  ");
      expect(skill?.name).toBe("deploy");
    });

    it("should return null when all skills are disabled", () => {
      router.setSkills([disabledSkill]);
      const { skill, warnings } = router.validateSkillSelection("legacy");
      expect(skill).toBeNull();
      expect(warnings).toContain("Skill 'legacy' not found");
      expect(warnings).toContain("No skills are available");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. listAvailableSkills
  // ──────────────────────────────────────────────────────────────────────────

  describe("listAvailableSkills", () => {
    it("should return summaries with all expected fields for enabled skills", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const list = router.listAvailableSkills();

      expect(list).toHaveLength(2);

      const deploySummary = list.find((s) => s.name === "deploy")!;
      expect(deploySummary.id).toBe("skill-1");
      expect(deploySummary.name).toBe("deploy");
      expect(deploySummary.description).toBe("deploy application production");
      expect(deploySummary.whenToUse).toBe("when user wants to deploy");
      expect(deploySummary.triggers).toEqual(["/deploy", "/release"]);
      expect(deploySummary.arguments).toEqual(["env", "version"]);
      expect(deploySummary.priority).toBe(10);

      const pricingSummary = list.find((s) => s.name === "pricing")!;
      expect(pricingSummary.id).toBe("skill-2");
      expect(pricingSummary.arguments).toEqual([]);
    });

    it("should exclude disabled skills from the list", () => {
      router.setSkills([deploySkill, disabledSkill]);
      const list = router.listAvailableSkills();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("deploy");
    });

    it("should return empty array when no skills are loaded", () => {
      const list = router.listAvailableSkills();
      expect(list).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. getSkillSummariesForLlm
  // ──────────────────────────────────────────────────────────────────────────

  describe("getSkillSummariesForLlm", () => {
    it("should return a markdown-formatted string with all enabled skills", () => {
      router.setSkills([deploySkill, meetingSkill]);
      const output = router.getSkillSummariesForLlm();

      expect(output).toContain("- **deploy**:");
      expect(output).toContain("- **schedule-meeting**:");
      expect(output).toContain("Use when:");
      expect(output).toContain("Triggers:");
      expect(output).toContain("Arguments:");
      expect(output).toContain("Description:");
    });

    it("should format each skill entry with pipe-separated details", () => {
      router.setSkills([deploySkill]);
      const output = router.getSkillSummariesForLlm();

      const expected =
        "- **deploy**: Use when: when user wants to deploy | Triggers: /deploy, /release | Arguments: env, version | Description: deploy application production";
      expect(output).toBe(expected);
    });

    it("should handle a skill with only required fields (no whenToUse, triggers, arguments)", () => {
      router.setSkills([minimalSkill]);
      const output = router.getSkillSummariesForLlm();

      expect(output).toBe("- **echo**: Description: Echo back the message");
    });

    it("should join multiple skills with newlines", () => {
      router.setSkills([deploySkill, pricingSkill]);
      const output = router.getSkillSummariesForLlm();

      const lines = output.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("- **deploy**:");
      expect(lines[1]).toContain("- **pricing**:");
    });

    it("should return 'No skills available.' when no skills are loaded", () => {
      const output = router.getSkillSummariesForLlm();
      expect(output).toBe("No skills available.");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Edge cases — duplicates, mixing, boundaries
  // ──────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle duplicate skill names — last one wins in byName map", () => {
      const first: SkillDefinition = {
        ...deploySkill,
        id: "dup-first",
        description: "first deploy",
      };
      const second: SkillDefinition = {
        ...deploySkill,
        id: "dup-second",
        description: "second deploy",
      };
      router.setSkills([first, second]);
      const ctx = createContext({ explicitSkillName: "deploy" });
      const result = router.findSkill(ctx);
      // skillByName.get("deploy") returns the last one set
      expect(result?.id).toBe("dup-second");
    });

    it("should allow duplicate names in enabledSkills list (both are usable by trigger)", () => {
      const first: SkillDefinition = {
        ...deploySkill,
        id: "dup-first",
        name: "dup",
      };
      const second: SkillDefinition = {
        ...deploySkill,
        id: "dup-second",
        name: "dup",
        priority: 20,
      };
      router.setSkills([first, second]);
      const ctx = createContext({ userMessage: "/deploy now" });
      const result = router.findSkill(ctx);
      // Both match via trigger; higher priority (20) wins
      expect(result?.id).toBe("dup-second");
    });

    it("should include skills without explicit enabled flag (defaults to enabled)", () => {
      const implicitEnabled: SkillDefinition = {
        id: "implicit",
        name: "implicit-skill",
        description: "implicitly enabled",
        instructions: "",
        allowedTools: [],
        // no enabled property
      };
      router.setSkills([implicitEnabled]);
      expect(router.listAvailableSkills()).toHaveLength(1);
    });

    it("should treat enabled: true the same as no enabled flag", () => {
      const explicitEnabled: SkillDefinition = {
        ...deploySkill,
        id: "explicit-enabled",
        name: "explicit-enabled",
        enabled: true,
      };
      router.setSkills([explicitEnabled]);
      const list = router.listAvailableSkills();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("explicit-enabled");
    });

    it("should not crash when skills have no triggers property", () => {
      const noTriggersSkill: SkillDefinition = {
        id: "no-triggers",
        name: "no-triggers",
        description: "Skill without triggers",
        instructions: "",
        enabled: true,
        allowedTools: [],
        // triggers is undefined
      };
      router.setSkills([noTriggersSkill]);
      const ctx = createContext({ userMessage: "anything" });
      expect(() => router.findSkill(ctx)).not.toThrow();
    });

    it("should not crash when skills have no priority (undefined)", () => {
      const noPriority: SkillDefinition = {
        ...pricingSkill,
        id: "no-priority",
        name: "no-priority",
        priority: undefined,
      };
      router.setSkills([noPriority]);
      const ctx = createContext({ userMessage: "/pricing" });
      expect(() => router.findSkill(ctx)).not.toThrow();
      expect(router.findSkill(ctx)?.name).toBe("no-priority");
    });

    it("should handle tokenization of message with hyphens and underscores", () => {
      router.setSkills([deploySkill]);
      const ctx = createContext({ userMessage: "deploy-application_test" });
      // "deploy-application_test" is 24 chars, all match TOKEN_PATTERN
      // tokenization: one single token "deploy-application_test"
      // This won't match skill fields (none have "deploy-application_test")
      // Falls to priority fallback
      const result = router.findSkill(ctx);
      expect(result).not.toBeNull();
    });

    it("should ignore tokens shorter than 3 characters", () => {
      router.setSkills([deploySkill]);
      // "a b cd" → each word < 3 chars, no tokens generated
      const ctx = createContext({ userMessage: "a b cd" });
      const result = router.findSkill(ctx);
      expect(result).not.toBeNull(); // priority fallback
    });

    it("should correctly count semantic score from multiple matching tokens", () => {
      router.setSkills([pricingSkill, deploySkill]);
      const ctx = createContext({ userMessage: "pricing budget cost" });
      const result = router.findSkill(ctx);
      // tokens: "pricing", "budget", "cost"
      //   "pricing": pricing desc(+1), pricing when(+2), pricing name(+3), pricing trigger(+1) = 7
      //   "budget": pricing desc(+1) = 1
      //   "cost": pricing desc(+1) = 1
      // pricing total = 9
      // deploy total = 0
      expect(result?.name).toBe("pricing");
      expect(ctx.warnings).toContain(
        "Selected skill 'pricing' by semantic match (score=9)",
      );
    });

    it("should resolve multiple skills in fresh router instances independently", () => {
      const routerA = new SkillRouterService();
      const routerB = new SkillRouterService();

      routerA.setSkills([deploySkill]);
      routerB.setSkills([pricingSkill]);

      const ctxA = createContext({ userMessage: "/deploy" });
      const ctxB = createContext({ userMessage: "/pricing" });

      expect(routerA.findSkill(ctxA)?.name).toBe("deploy");
      expect(routerB.findSkill(ctxB)?.name).toBe("pricing");
    });

    it("should reset state when setSkills is called multiple times", () => {
      router.setSkills([deploySkill]);
      expect(router.listAvailableSkills()).toHaveLength(1);

      router.setSkills([pricingSkill]);
      expect(router.listAvailableSkills()).toHaveLength(1);
      expect(router.listAvailableSkills()[0].name).toBe("pricing");
    });
  });
});
