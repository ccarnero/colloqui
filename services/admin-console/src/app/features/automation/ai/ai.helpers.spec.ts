import { describe, it, expect } from "vitest";
import {
  extractMentionsFromPrompt,
  formatHttpErrorMessage,
  mapSubagentConfigToDraft,
} from "./ai.helpers";

describe("ai.helpers", () => {
  it("formatHttpErrorMessage joins array messages", () => {
    expect(formatHttpErrorMessage(["a", "b"], "x")).toBe("a, b");
    expect(formatHttpErrorMessage("one", "x")).toBe("one");
    expect(formatHttpErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("extractMentionsFromPrompt dedupes matches", () => {
    const text = "run @tool:alpha and @tool:alpha";
    expect(extractMentionsFromPrompt(text)).toEqual(["@tool:alpha"]);
  });

  describe("mapSubagentConfigToDraft", () => {
    // T9: preserves catalog_skill_id as catalogSkillId
    it("preserves catalog_skill_id as catalogSkillId (BUG-1)", () => {
      const config = {
        name: "Web Search",
        system_prompt: "Search the web",
        description: "A web search skill",
        enabled: true,
        catalog_skill_id: "skill-1",
      };

      const result = mapSubagentConfigToDraft(config);

      expect(result.catalogSkillId).toBe("skill-1");
    });

    // T10: handles missing catalog_skill_id gracefully
    it("handles missing catalog_skill_id gracefully (BUG-1)", () => {
      const config = {
        name: "Manual Skill",
        system_prompt: "Do something",
        description: "",
        enabled: true,
      };

      const result = mapSubagentConfigToDraft(config);

      expect(result.catalogSkillId).toBeUndefined();
    });
  });
});
