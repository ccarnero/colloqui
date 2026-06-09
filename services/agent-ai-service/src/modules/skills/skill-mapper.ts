import type { SkillDefinition } from "./skill-definition";

export interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  trigger_commands: string[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: string;
  files?: unknown[];
  is_active?: boolean;
}

export function catalogSkillToSkillDefinition(
  catalog: CatalogSkill,
): SkillDefinition {
  return {
    id: catalog.id,
    name: catalog.name,
    description: catalog.description,
    enabled: catalog.is_active ?? true,
    instructions: catalog.system_prompt,
    whenToUse: catalog.when_to_use,
    triggers: catalog.trigger_commands ?? [],
    allowedTools: catalog.allowed_tools ?? [],
    mode: (catalog.mode as SkillDefinition["mode"]) ?? undefined,
    priority: catalog.priority ?? 0,
  };
}
