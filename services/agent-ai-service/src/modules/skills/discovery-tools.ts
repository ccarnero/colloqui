import { jsonSchema } from "ai";
import type { Tool } from "ai";
import type { SkillRouterService } from "./skill-router.service";
import type { SkillDefinition } from "./skill-definition";

export function createActivateSkillTool(
  router: SkillRouterService,
  onActivate?: (skill: SkillDefinition) => void,
): Tool {
  return {
    description:
      "Activate a skill to receive its full instructions. " +
      "Call this when you detect the user's intent matches one of the available skills. " +
      "The returned instructions tell you exactly how to handle the request.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description:
            "The name of the skill to activate (from the available skills catalog)",
        },
        reasoning: {
          type: "string",
          description:
            "Brief explanation of why this skill matches the user's intent",
        },
      },
      required: ["skill_name"],
    }),
    execute: async (args: Record<string, unknown>) => {
      const skillName = String(args.skill_name ?? "").trim();
      const reasoning = String(args.reasoning ?? "").trim();

      if (!skillName) {
        return { success: false, error: "skill_name is required" };
      }

      const { skill, warnings } = router.validateSkillSelection(skillName);

      if (!skill) {
        return {
          success: false,
          error: `Skill '${skillName}' not found`,
          warnings,
        };
      }

      onActivate?.(skill);

      return {
        success: true,
        skill_name: skillName,
        skill_id: skill.id,
        instructions: skill.instructions,
        allowed_tools: skill.allowedTools,
        arguments: skill.arguments,
        guidance:
          "Follow the instructions above to handle the user's request. " +
          "Use only the allowed_tools listed if any are specified.",
      };
    },
  };
}

export function createListSkillsTool(
  router: SkillRouterService,
): Tool {
  return {
    description:
      "List all available skills with their capabilities and usage guidance",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        filter_by_trigger: {
          type: "string",
          description:
            "Optional: filter skills by trigger command (e.g., '/help')",
        },
        include_disabled: {
          type: "boolean",
          default: false,
          description: "Include disabled skills in the results",
        },
      },
    }),
    execute: async (args: Record<string, unknown>) => {
      const filterByTrigger = String(args.filter_by_trigger ?? "").trim();
      const availableSkills = router.listAvailableSkills();

      let filtered = availableSkills;
      if (filterByTrigger) {
        filtered = filtered.filter(
          (s) => s.triggers?.some((t) => t.includes(filterByTrigger)),
        );
      }

      const skillList = filtered
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .map((s) => {
          const info: Record<string, unknown> = {
            name: s.name,
            id: s.id,
            description: s.description,
            priority: s.priority,
          };
          if (s.whenToUse) info.when_to_use = s.whenToUse;
          if (s.triggers?.length) info.triggers = s.triggers;
          if (s.arguments?.length) info.arguments = s.arguments;
          return info;
        });

      return {
        success: true,
        skills: skillList,
        total_count: skillList.length,
        routing_summary: router.getSkillSummariesForLlm(),
      };
    },
  };
}

export function createDiscoveryTools(
  router: SkillRouterService,
  onActivate?: (skill: SkillDefinition) => void,
): Record<string, Tool> {
  return {
    ActivateSkill: createActivateSkillTool(router, onActivate),
    ListSkills: createListSkillsTool(router),
  };
}
