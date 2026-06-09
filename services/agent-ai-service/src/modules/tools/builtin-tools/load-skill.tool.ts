import type { ToolDef, ToolHandler, ToolResult } from "../tool-definition";
import type { SkillFileService } from "../../skills/skill-file.service";

export function createLoadSkillToolDef(): ToolDef {
  return {
    name: "loadSkill",
    description:
      "Load a skill to get specialized instructions for a task. " +
      "Call this when the user's request would benefit from specialized knowledge or workflows. " +
      "Returns the full skill instructions.",
    builtin: true,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "The name of the skill to load (from the available skills catalog)",
        },
      },
      required: ["name"],
    },
  };
}

export function createLoadSkillHandler(
  skillFileService: SkillFileService,
): ToolHandler {
  return async (
    params: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const name = String(params.name ?? "").trim();

    if (!name) {
      return {
        success: false,
        output: null,
        error: "Skill name is required",
      };
    }

    const skill = skillFileService.loadSkill(name);
    if (!skill) {
      return {
        success: false,
        output: null,
        error: `Skill '${name}' not found. Available skills: ${skillFileService
          .discoverSkills()
          .map((s) => s.name)
          .join(", ")}`,
      };
    }

    return {
      success: true,
      output: {
        name: skill.name,
        description: skill.description,
        instructions: skill.content,
        directory: skill.path,
      },
    };
  };
}
