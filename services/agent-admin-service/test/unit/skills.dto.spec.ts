import "../setup-env";
import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import {
  CreateSkillDto,
  UpdateSkillDto,
} from "../../src/modules/skills/skills.dto";

// ---------------------------------------------------------------------------
// BUG-2: Catalog ISkill → SkillDefinition mapping
//
// The CreateSkillDto and UpdateSkillDto are missing validation for the new
// fields required by the runtime SkillDefinition interface:
//   - when_to_use  (string)
//   - priority     (integer)
//   - allowed_tools (string array)
//   - mode         (enum: router | llm_driven | inline)
//
// These tests will FAIL until the DTO classes add the corresponding
// class-validator decorators for these four fields.
// ---------------------------------------------------------------------------

describe("CreateSkillDto — new BUG-2 fields", () => {
  // =========================================================================
  //  Valid inputs — document expected shape
  // =========================================================================

  it("accepts valid when_to_use, priority, allowed_tools, mode (T1)", async () => {
    const dto = new CreateSkillDto();
    dto.name = "pricing-skill";
    dto.system_prompt = "You are a pricing assistant";
    dto.when_to_use = "When the user asks about pricing or subscriptions";
    dto.priority = 5;
    dto.allowed_tools = ["communicate", "search_tickets"];
    dto.mode = "router";

    const errors = await validate(dto);

    // No decorators yet → validate() ignores these fields → returns 0 errors.
    // Once @IsString, @IsInt, @Min, @IsArray, @IsIn etc. are added,
    // this should still return 0 for valid values.
    expect(errors.length).toBe(0);
  });

  // =========================================================================
  //  Invalid mode
  // =========================================================================

  it("rejects invalid mode value (not in router|llm_driven|inline) (T2)", async () => {
    const dto = new CreateSkillDto();
    dto.name = "bad-mode-skill";
    dto.system_prompt = "prompt";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dto as any).mode = "not_a_mode";

    const errors = await validate(dto);
    const modeErrors = errors.filter((e) => e.property === "mode");

    // **FAILS currently** — no @IsIn decorator on mode yet.
    // Expect at least one validation error with an isIn constraint.
    expect(modeErrors.length).toBeGreaterThan(0);
    expect(modeErrors[0]!.constraints).toBeDefined();
    expect(modeErrors[0]!.constraints!.isIn).toBeDefined();
  });

  // =========================================================================
  //  Invalid priority
  // =========================================================================

  it("rejects negative priority (T3)", async () => {
    const dto = new CreateSkillDto();
    dto.name = "neg-priority-skill";
    dto.system_prompt = "prompt";
    (dto as any).priority = -1;

    const errors = await validate(dto);
    const priorityErrors = errors.filter((e) => e.property === "priority");

    // **FAILS currently** — no @IsInt or @Min(0) decorators on priority yet.
    expect(priorityErrors.length).toBeGreaterThan(0);
  });
});

describe("UpdateSkillDto — new BUG-2 fields", () => {
  // =========================================================================
  //  Partial update — only new fields
  // =========================================================================

  it("accepts partial update with only new fields (T4)", async () => {
    const dto = new UpdateSkillDto();
    // Set only the new BUG-2 fields
    dto.when_to_use = "Updated usage description";
    dto.priority = 10;
    dto.allowed_tools = ["search_tickets"];
    dto.mode = "llm_driven";

    const errors = await validate(dto);

    // All UpdateSkillDto fields are optional, so validating only the
    // new ones should succeed (0 errors).
    expect(errors.length).toBe(0);
  });

  // =========================================================================
  //  Full update — all existing + new fields
  // =========================================================================

  it("accepts full update with all new fields (T5)", async () => {
    const dto = new UpdateSkillDto();
    dto.name = "updated-skill";
    dto.description = "Updated description";
    dto.system_prompt = "Updated prompt";
    dto.icon = "rocket";
    dto.color = "#ff5722";
    dto.trigger_commands = ["/pricing", "/subscription"];
    dto.is_active = true;
    dto.when_to_use = "When user asks about anything";
    dto.priority = 100;
    dto.allowed_tools = ["communicate", "resource", "calendar"];
    dto.mode = "inline";

    const errors = await validate(dto);

    // All fields are valid — should produce 0 errors.
    // NOTE: `files` is excluded here because @ValidateNested requires
    // class instances, not plain objects — that's a pre-existing concern
    // unrelated to the BUG-2 new fields.
    expect(errors.length).toBe(0);
  });
});
