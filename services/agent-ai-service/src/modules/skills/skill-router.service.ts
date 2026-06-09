import { Injectable, Logger } from "@nestjs/common";
import type { SkillDefinition, SkillContext } from "./skill-definition";

const TOKEN_PATTERN = /[a-z0-9_-]{3,}/g;

const TOKEN_ALIASES: Record<string, string> = {
  precio: "pricing",
  precios: "pricing",
  costo: "pricing",
  costos: "pricing",
  presupuesto: "pricing",
  presupuestos: "pricing",
  price: "pricing",
  comprar: "buy",
  compra: "buy",
  venta: "sales",
  ventas: "sales",
  soporte: "support",
  ayuda: "support",
  problema: "issue",
  problemas: "issue",
  error: "issue",
  errores: "issue",
  demostracion: "demo",
  reunion: "meeting",
  agendar: "schedule",
  agenda: "schedule",
  objecion: "objection",
  objeciones: "objection",
  competencia: "competitor",
};

function stripAccents(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function tokenize(value: string): Set<string> {
  const lowered = stripAccents(value.toLowerCase());
  const tokens = new Set<string>();
  const matches = lowered.matchAll(TOKEN_PATTERN);
  for (const m of matches) {
    const raw = m[0];
    tokens.add(TOKEN_ALIASES[raw] ?? raw);
  }
  return tokens;
}

@Injectable()
export class SkillRouterService {
  private readonly logger = new Logger(SkillRouterService.name);

  private enabledSkills: SkillDefinition[] = [];
  private skillByName = new Map<string, SkillDefinition>();
  private skillsByPriority: SkillDefinition[] = [];

  setSkills(skills: readonly SkillDefinition[]): void {
    this.enabledSkills = skills.filter((s) => s.enabled !== false);
    this.skillByName.clear();
    for (const skill of this.enabledSkills) {
      this.skillByName.set(skill.name, skill);
    }
    this.skillsByPriority = [...this.enabledSkills].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    if (this.enabledSkills.length === 0) {
      this.logger.warn("No enabled skills available for routing");
    }
  }

  findSkill(context: SkillContext): SkillDefinition | null {
    if (this.enabledSkills.length === 0) {
      context.warnings.push("No enabled skills available");
      return null;
    }

    const byTrigger = this.resolveByTrigger(context);
    if (byTrigger) return byTrigger;

    const byName = this.resolveByName(context);
    if (byName) return byName;

    const bySemantic = this.resolveBySemantics(context);
    if (bySemantic) return bySemantic;

    const byPriority = this.resolveByPriority();
    if (byPriority) {
      context.warnings.push(
        `Using priority fallback to skill '${byPriority.name}' (no explicit trigger or name matched)`,
      );
      return byPriority;
    }

    context.warnings.push("No skill could be resolved");
    return null;
  }

  validateSkillSelection(
    skillName: string,
  ): { skill: SkillDefinition | null; warnings: string[] } {
    const warnings: string[] = [];
    const found = this.skillByName.get(skillName.trim());
    if (!found) {
      warnings.push(`Skill '${skillName}' not found`);
      const available = Array.from(this.skillByName.keys());
      if (available.length > 0) {
        warnings.push(`Available skills: ${available.join(", ")}`);
      } else {
        warnings.push("No skills are available");
      }
    }
    return { skill: found ?? null, warnings };
  }

  listAvailableSkills(): Array<{
    id: string;
    name: string;
    description: string;
    whenToUse?: string;
    triggers?: readonly string[];
    arguments?: readonly string[];
    priority?: number;
  }> {
    return this.enabledSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      triggers: s.triggers,
      arguments: s.arguments,
      priority: s.priority,
    }));
  }

  getSkillSummariesForLlm(): string {
    if (this.enabledSkills.length === 0) return "No skills available.";

    return this.enabledSkills
      .map((s) => {
        const parts: string[] = [];
        if (s.whenToUse) parts.push(`Use when: ${s.whenToUse}`);
        if (s.triggers?.length) parts.push(`Triggers: ${s.triggers.join(", ")}`);
        if (s.arguments?.length) parts.push(`Arguments: ${s.arguments.join(", ")}`);
        if (s.description) parts.push(`Description: ${s.description}`);
        return `- **${s.name}**: ${parts.join(" | ")}`;
      })
      .join("\n");
  }

  private resolveByTrigger(context: SkillContext): SkillDefinition | null {
    const message = context.userMessage.trim();
    const matching = this.enabledSkills.filter((s) => {
      const triggers = s.triggers ?? [];
      return triggers.some((t) => message.startsWith(t));
    });

    if (matching.length === 0) return null;
    if (matching.length === 1) return matching[0];

    const best = matching.reduce((a, b) =>
      (b.priority ?? 0) > (a.priority ?? 0) ? b : a,
    );
    context.warnings.push(
      `Multiple triggers matched, selected '${best.name}' by priority`,
    );
    return best;
  }

  private resolveByName(context: SkillContext): SkillDefinition | null {
    if (!context.explicitSkillName) return null;
    const skill = this.skillByName.get(context.explicitSkillName.trim());
    if (!skill) {
      context.warnings.push(
        `Explicit skill '${context.explicitSkillName}' not found, will use fallback`,
      );
    }
    return skill ?? null;
  }

  private resolveBySemantics(context: SkillContext): SkillDefinition | null {
    const messageTokens = tokenize(context.userMessage);
    if (messageTokens.size === 0) return null;

    let bestMatch: SkillDefinition | null = null;
    let bestScore = 0;

    for (const skill of this.enabledSkills) {
      const score = this.scoreSkill(messageTokens, skill);
      if (score <= 0) continue;

      if (
        score > bestScore ||
        (score === bestScore &&
          bestMatch !== null &&
          (skill.priority ?? 0) > (bestMatch.priority ?? 0))
      ) {
        bestMatch = skill;
        bestScore = score;
      }
    }

    if (bestMatch) {
      context.warnings.push(
        `Selected skill '${bestMatch.name}' by semantic match (score=${bestScore})`,
      );
    }
    return bestMatch;
  }

  private scoreSkill(
    messageTokens: Set<string>,
    skill: SkillDefinition,
  ): number {
    const descTokens = tokenize(skill.description);
    const whenTokens = tokenize(skill.whenToUse ?? "");
    const nameTokens = tokenize(skill.name);

    const triggerTokens = new Set<string>();
    for (const t of skill.triggers ?? []) {
      for (const tok of tokenize(t.replace(/^\//, ""))) triggerTokens.add(tok);
    }

    let score = 0;
    for (const t of messageTokens) {
      if (descTokens.has(t)) score += 1;
      if (whenTokens.has(t)) score += 2;
      if (triggerTokens.has(t)) score += 1;
      if (nameTokens.has(t)) score += 3;
    }
    return score;
  }

  private resolveByPriority(): SkillDefinition | null {
    return this.skillsByPriority[0] ?? null;
  }
}
