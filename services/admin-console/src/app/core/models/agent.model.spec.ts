import { describe, it, expect } from "vitest";
import {
  buildSubagentConfig,
  type ISubagentConfig,
  type ISubagentDraft,
} from "./agent.model";

describe("buildSubagentConfig", () => {
  // T5: includes catalog_skill_id when catalogSkillId is set
  it("includes catalog_skill_id when catalogSkillId is set (BUG-1)", () => {
    const draft: ISubagentDraft = {
      name: "Web Search",
      systemPrompt: "You can search the web",
      catalogSkillId: "skill-1",
    };

    const result: ISubagentConfig = buildSubagentConfig(draft);

    expect(result.catalog_skill_id).toBe("skill-1");
  });

  // T6: omits catalog_skill_id when undefined (backward compat)
  it("omits catalog_skill_id when catalogSkillId is undefined (BUG-1 backward compat)", () => {
    const draft: ISubagentDraft = {
      name: "Manual Skill",
      systemPrompt: "Do something",
    };

    const result: ISubagentConfig = buildSubagentConfig(draft);

    expect(result.catalog_skill_id).toBeUndefined();
  });
});

describe("ISubagentDraft", () => {
  // T7: accepts optional catalogSkillId field
  it("accepts optional catalogSkillId field (BUG-1)", () => {
    const draft: ISubagentDraft = {
      name: "Web Search",
      systemPrompt: "Search the web",
      catalogSkillId: "skill-1",
    };

    expect(draft.catalogSkillId).toBe("skill-1");
  });
});

describe("ISubagentConfig", () => {
  // T8: accepts optional catalog_skill_id field
  it("accepts optional catalog_skill_id field (BUG-1)", () => {
    const config: ISubagentConfig = {
      name: "Web Search",
      system_prompt: "Search the web",
      catalog_skill_id: "skill-1",
    };

    expect(config.catalog_skill_id).toBe("skill-1");
  });
});
