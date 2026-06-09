import { Injectable, Logger } from "@nestjs/common";
import type { SkillDefinition, SkillResult } from "./skill-definition";
import { substituteArguments } from "./argument-parser";
import type { ToolExecutorService } from "../tools/tool-executor.service";
import type { LlmExecutorService } from "../llm/llm-executor.service";
import { ToolRegistryService } from "../tools/tool-registry.service";

export interface SkillExecutionParams {
  readonly skill: SkillDefinition;
  readonly userMessage: string;
  readonly skillArgs?: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly provider: string;
  readonly model: string;
  readonly context?: Record<string, unknown>;
}

@Injectable()
export class SkillExecutorService {
  private readonly logger = new Logger(SkillExecutorService.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async executeInline(params: SkillExecutionParams): Promise<SkillResult> {
    const { skill, userMessage, skillArgs = "" } = params;

    this.logger.log(`Executing skill '${skill.name}' in inline mode`);

    const substituted = this.substituteInstructions(skill, skillArgs);

    return {
      success: true,
      skillName: skill.name,
      skillId: skill.id,
      executionMode: "inline",
      processedInstructions: substituted,
      output: undefined,
      warnings: [],
    };
  }

  buildSkillContext(
    skill: SkillDefinition,
    skillArgs = "",
  ): {
    systemPrompt: string;
    allowedTools: string[];
  } {
    const substituted = this.substituteInstructions(skill, skillArgs);
    return {
      systemPrompt: substituted,
      allowedTools: [...(skill.allowedTools ?? [])],
    };
  }

  private substituteInstructions(
    skill: SkillDefinition,
    skillArgs: string,
  ): string {
    const kwargs: Record<string, string> = {};

    const args = skill.arguments ?? [];
    if (skillArgs.includes("=")) {
      for (const part of skillArgs.trim().split(/\s+/)) {
        const eqIndex = part.indexOf("=");
        if (eqIndex > 0) {
          kwargs[part.slice(0, eqIndex).trim()] = part.slice(eqIndex + 1).trim();
        }
      }
    }

    if (skillArgs) {
      const parts = skillArgs.trim().split(/\s+/);
      for (let i = 0; i < args.length && i < parts.length; i++) {
        const key = `ARG_${i + 1}`;
        if (!(key in kwargs)) kwargs[key] = parts[i];
      }
    }

    return substituteArguments(
      skill.instructions,
      args,
      skillArgs,
      kwargs,
    );
  }
}
