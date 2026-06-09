import { describe, it, expect, beforeEach } from "bun:test";
import { SkillExecutorService } from "../../src/modules/skills/skill-executor.service";
import type { SkillExecutionParams } from "../../src/modules/skills/skill-executor.service";
import type { SkillDefinition } from "../../src/modules/skills/skill-definition";
import { ToolRegistryService } from "../../src/modules/tools/tool-registry.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const createMockSkill = (
  overrides: Partial<SkillDefinition> = {},
): SkillDefinition => ({
  id: "skill-1",
  name: "test-skill",
  description: "A test skill",
  instructions: "You are a helpful assistant. Process $ARG_1.",
  arguments: ["input"],
  allowedTools: [],
  ...overrides,
});

const createParams = (
  overrides: Partial<SkillExecutionParams> = {},
): SkillExecutionParams => ({
  skill: createMockSkill(),
  userMessage: "do something",
  tenantId: "tenant-1",
  agentId: "agent-1",
  executionId: "exec-1",
  provider: "openai",
  model: "gpt-4",
  ...overrides,
});

// ── Suite ─────────────────────────────────────────────────────────────────

describe("SkillExecutorService", () => {
  let service: SkillExecutorService;

  beforeEach(() => {
    // ToolRegistryService is required by DI but not exercised in these tests
    const toolRegistry = new ToolRegistryService();
    service = new SkillExecutorService(toolRegistry);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. executeInline — basic shape and defaults
  // ──────────────────────────────────────────────────────────────────────────

  describe("executeInline — basic shape", () => {
    it("should return success=true", async () => {
      const result = await service.executeInline(createParams());
      expect(result.success).toBe(true);
    });

    it("should return executionMode='inline'", async () => {
      const result = await service.executeInline(createParams());
      expect(result.executionMode).toBe("inline");
    });

    it("should return skillName matching skill.name", async () => {
      const skill = createMockSkill({ name: "my-skill" });
      const result = await service.executeInline(createParams({ skill }));
      expect(result.skillName).toBe("my-skill");
    });

    it("should return skillId matching skill.id", async () => {
      const skill = createMockSkill({ id: "abc-123" });
      const result = await service.executeInline(createParams({ skill }));
      expect(result.skillId).toBe("abc-123");
    });

    it("should return output as undefined", async () => {
      const result = await service.executeInline(createParams());
      expect(result.output).toBeUndefined();
    });

    it("should return warnings as empty array", async () => {
      const result = await service.executeInline(createParams());
      expect(result.warnings).toEqual([]);
    });

    it("should include processedInstructions with substituted text", async () => {
      const skill = createMockSkill({
        instructions: "Hello $ARG_1!",
        arguments: ["name"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "world" }),
      );
      expect(result.processedInstructions).toBe("Hello world!");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. executeInline — argument substitution
  // ──────────────────────────────────────────────────────────────────────────

  describe("executeInline — argument substitution", () => {
    it("should substitute a single positional arg into instructions", async () => {
      const skill = createMockSkill({
        instructions: "Deploy to $ARG_1",
        arguments: ["env"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "production" }),
      );
      expect(result.processedInstructions).toBe("Deploy to production");
    });

    it("should substitute multiple positional args", async () => {
      const skill = createMockSkill({
        instructions: "Deploy $ARG_1 to $ARG_2",
        arguments: ["app", "env"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "frontend staging" }),
      );
      expect(result.processedInstructions).toBe("Deploy frontend to staging");
    });

    it("should return raw instructions when skillArgs is empty", async () => {
      const skill = createMockSkill({
        instructions: "No placeholders here.",
        arguments: [],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "" }),
      );
      expect(result.processedInstructions).toBe("No placeholders here.");
    });

    it("should return raw instructions when skillArgs is undefined", async () => {
      const skill = createMockSkill({
        instructions: "Just instructions.",
        arguments: [],
      });
      const result = await service.executeInline(
        createParams({ skill /* skillArgs undefined */ }),
      );
      expect(result.processedInstructions).toBe("Just instructions.");
    });

    it("should handle instructions with no placeholders even when args are provided", async () => {
      const skill = createMockSkill({
        instructions: "Static instructions.",
        arguments: ["unused"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "ignored" }),
      );
      expect(result.processedInstructions).toBe("Static instructions.");
    });

    it("should substitute $ARGUMENTS with the full raw args string", async () => {
      const skill = createMockSkill({
        instructions: "Full input: $ARGUMENTS",
        arguments: [],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "hello world foo" }),
      );
      expect(result.processedInstructions).toBe("Full input: hello world foo");
    });

    it("should handle complex instructions with multiple $ARG_N placeholders", async () => {
      const skill = createMockSkill({
        instructions: "Step 1: $ARG_1, Step 2: $ARG_2, Step 3: $ARG_3",
        arguments: ["a", "b", "c"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "alpha beta gamma" }),
      );
      expect(result.processedInstructions).toBe(
        "Step 1: alpha, Step 2: beta, Step 3: gamma",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. executeInline — named and mixed args
  // ──────────────────────────────────────────────────────────────────────────

  describe("executeInline — named and mixed args", () => {
    it("should substitute named key=value args", async () => {
      const skill = createMockSkill({
        instructions: "Env: $env, Version: $version",
        arguments: ["env", "version"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "env=production version=2.0" }),
      );
      expect(result.processedInstructions).toBe(
        "Env: production, Version: 2.0",
      );
    });

    it("should substitute mixed positional and named args", async () => {
      const skill = createMockSkill({
        instructions: "App: $ARG_1, Env: $env",
        arguments: ["app", "env"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "frontend env=staging" }),
      );
      expect(result.processedInstructions).toBe(
        "App: frontend, Env: staging",
      );
    });

    it("should handle key=value with empty value (equals but nothing after)", async () => {
      const skill = createMockSkill({
        instructions: "Value: $key",
        arguments: ["key"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "key=" }),
      );
      // "key=" → eqIndex=3, slice(4).trim() = "" → kwargs["key"] = ""
      expect(result.processedInstructions).toBe("Value: ");
    });

    it("should trim leading/trailing spaces in skillArgs", async () => {
      const skill = createMockSkill({
        instructions: "Hello $ARG_1",
        arguments: ["name"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "  world  " }),
      );
      expect(result.processedInstructions).toBe("Hello world");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. buildSkillContext
  // ──────────────────────────────────────────────────────────────────────────

  describe("buildSkillContext", () => {
    it("should return systemPrompt equal to substituted instructions", () => {
      const skill = createMockSkill({
        instructions: "Process $ARG_1 now",
        arguments: ["item"],
      });
      const ctx = service.buildSkillContext(skill, "data");
      expect(ctx.systemPrompt).toBe("Process data now");
    });

    it("should return allowedTools from skill definition", () => {
      const skill = createMockSkill({
        allowedTools: ["tool-a", "tool-b"],
      });
      const ctx = service.buildSkillContext(skill);
      expect(ctx.allowedTools).toEqual(["tool-a", "tool-b"]);
    });

    it("should return empty array when skill has no allowedTools", () => {
      const skill = createMockSkill({ allowedTools: undefined });
      const ctx = service.buildSkillContext(skill);
      expect(ctx.allowedTools).toEqual([]);
    });

    it("should return a copy of allowedTools, not the original reference", () => {
      const skill = createMockSkill({
        allowedTools: ["tool-a"],
      });
      const ctx = service.buildSkillContext(skill);
      // Mutate the returned array
      ctx.allowedTools.push("tool-b");
      // Original should be unaffected
      expect(skill.allowedTools).toEqual(["tool-a"]);
    });

    it("should default skillArgs to empty string when omitted", () => {
      const skill = createMockSkill({
        instructions: "Raw: $ARG_1",
        arguments: ["x"],
      });
      // Calling without skillArgs — defaults to ""
      const ctx = service.buildSkillContext(skill);
      expect(ctx.systemPrompt).toBe("Raw: ");
    });

    it("should substitute args into systemPrompt", () => {
      const skill = createMockSkill({
        instructions: "Run $ARG_1 in $ARG_2",
        arguments: ["cmd", "env"],
      });
      const ctx = service.buildSkillContext(skill, "deploy production");
      expect(ctx.systemPrompt).toBe("Run deploy in production");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Edge cases — missing/empty arguments, special characters
  // ──────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle skill with no arguments array (undefined)", async () => {
      const skill = createMockSkill({
        instructions: "No args $ARG_1",
        arguments: undefined,
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "test" }),
      );
      // arguments is undefined → defaults to [] in substituteInstructions
      // No positional assignment because args is []
      // But substituteArguments still resolves ARG_1 from kwargs or raw parts
      // Since no positional loop runs, kwargs is empty → ARG_1 resolves via
      // the ARG_N fallback in substituteArguments (posIndex=0, parts[0]="test")
      expect(result.processedInstructions).toBe("No args test");
    });

    it("should handle skill with empty arguments array", async () => {
      const skill = createMockSkill({
        instructions: "Hello $ARG_1",
        arguments: [],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "world" }),
      );
      // args is [], no positional loop → kwargs empty
      // substituteArguments resolves ARG_1 via ARG_N fallback → parts[0] = "world"
      expect(result.processedInstructions).toBe("Hello world");
    });

    it("should handle skillArgs with only whitespace", async () => {
      const skill = createMockSkill({
        instructions: "Result: $ARG_1",
        arguments: ["x"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "   " }),
      );
      // After trim() → "", split → [""] → ARG_1 = ""
      expect(result.processedInstructions).toBe("Result: ");
    });

    it("should handle key=value where value contains special characters", async () => {
      const skill = createMockSkill({
        instructions: "URL: $url",
        arguments: ["url"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "url=https://example.com/path?q=1" }),
      );
      // eqIndex = 3, so key="url", value="https://example.com/path?q=1"
      // But wait, "q=1" contains another "=" — the split is by whitespace,
      // so the whole "url=https://example.com/path?q=1" is one part.
      // eqIndex is the FIRST "=" → key="url", value="https://example.com/path?q=1"
      expect(result.processedInstructions).toBe(
        "URL: https://example.com/path?q=1",
      );
    });

    it("should not crash when executionId is present in params", async () => {
      const params = createParams({ executionId: "unique-exec-42" });
      const result = await service.executeInline(params);
      expect(result.success).toBe(true);
      // executionId is not returned in SkillResult — just verify no crash
    });

    it("should handle empty instructions", async () => {
      const skill = createMockSkill({
        instructions: "",
        arguments: ["x"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "anything" }),
      );
      expect(result.processedInstructions).toBe("");
    });

    it("should substitute case-insensitively when using named args", async () => {
      const skill = createMockSkill({
        instructions: "Value: $MyKey",
        arguments: ["mykey"],
      });
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "MyKey=hello" }),
      );
      // substituteArguments falls back to case-insensitive kwargs match
      expect(result.processedInstructions).toBe("Value: hello");
    });

    it("should handle value with equals sign after the first split", async () => {
      const skill = createMockSkill({
        instructions: "Config: $db",
        arguments: ["db"],
      });
      // "db=host=localhost" → first "=" at index 2 → key="db", value="host=localhost"
      const result = await service.executeInline(
        createParams({ skill, skillArgs: "db=host=localhost" }),
      );
      expect(result.processedInstructions).toBe("Config: host=localhost");
    });
  });
});
