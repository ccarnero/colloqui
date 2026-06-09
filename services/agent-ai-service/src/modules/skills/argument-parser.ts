const ARG_PATTERN = /\$(ARGUMENTS|\w+)/g;

export function substituteArguments(
  template: string,
  arguments_: readonly string[],
  rawArgs = "",
  kwargs: Record<string, string> = {},
): string {
  if (!template) return template;

  return template.replace(ARG_PATTERN, (match, placeholder: string) => {
    if (placeholder === "ARGUMENTS") return rawArgs;

    if (placeholder in kwargs) return kwargs[placeholder];

    for (const [key, value] of Object.entries(kwargs)) {
      if (key.toLowerCase() === placeholder.toLowerCase()) return value;
    }

    const argIndex = arguments_.findIndex(
      (a) => a.toLowerCase() === placeholder.toLowerCase(),
    );
    if (argIndex >= 0) {
      const parts = rawArgs.trim().split(/\s+/);
      if (argIndex < parts.length) return parts[argIndex];
    }

    if (placeholder.startsWith("ARG_")) {
      const posIndex = Number.parseInt(placeholder.slice(4), 10) - 1;
      if (!Number.isNaN(posIndex)) {
        const parts = rawArgs.trim().split(/\s+/);
        if (posIndex >= 0 && posIndex < parts.length) return parts[posIndex];
      }
    }

    return "";
  });
}

export function extractArgumentNames(template: string): string[] {
  if (!template) return [];
  const matches = template.matchAll(ARG_PATTERN);
  const names = new Set<string>();
  for (const m of matches) {
    if (m[1] !== "ARGUMENTS") names.add(m[1]);
  }
  return Array.from(names);
}

export function validateSkillArguments(
  template: string,
  definedArguments: readonly string[],
  providedArgs = "",
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const referenced = extractArgumentNames(template);
  const referencedLower = referenced.map((a) => a.toLowerCase());
  const definedLower = definedArguments.map((a) => a.toLowerCase());

  for (const ref of referenced) {
    if (!definedLower.includes(ref.toLowerCase())) {
      warnings.push(`Template references undefined argument: $${ref}`);
    }
  }

  for (const def of definedArguments) {
    if (!referencedLower.includes(def.toLowerCase())) {
      warnings.push(`Defined argument not used in template: ${def}`);
    }
  }

  if (referenced.length > 0 && providedArgs) {
    const positionalNeeded = referenced.filter((a) => a.startsWith("ARG_")).length;
    const provided = providedArgs.trim().split(/\s+/).length;
    if (provided < positionalNeeded) {
      warnings.push(
        `Expected ${positionalNeeded} positional arguments, got ${provided}`,
      );
    }
  }

  return { valid: warnings.length === 0, warnings };
}
