export enum SkillMode {
  ROUTER = "router",
  LLM_DRIVEN = "llm_driven",
  INLINE = "inline",
}

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled?: boolean;
  readonly instructions: string;
  readonly whenToUse?: string;
  readonly triggers?: readonly string[];
  readonly arguments?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly mode?: SkillMode;
  readonly contextMode?: "inline" | "fork";
  readonly modelOverride?: string;
  readonly priority?: number;
  readonly config?: Record<string, unknown>;
}

export interface SkillResult {
  readonly success: boolean;
  readonly skillName: string;
  readonly skillId: string;
  readonly executionMode: string;
  readonly processedInstructions?: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly warnings?: readonly string[];
}

export interface SkillContext {
  readonly userMessage: string;
  readonly explicitSkillName?: string;
  readonly availableSkills: readonly SkillDefinition[];
  readonly warnings: string[];
}
