/**
 * Prompt reference parsing helpers for agent prompts.
 *
 * Extracts `@skill:` and `@tool:` references from prompt text and returns
 * the cleaned text with those references stripped.
 */

const PROMPT_REFERENCE_PATTERN = /@(?<kind>skill|tool):(?<name>[A-Za-z0-9_ -]+?)(?:\s+(?:skill|tool|and|or|the|for|when|while|using|with|to)\s|[,.!?;:\n]|\s*$)/g;

export interface PromptReferenceResult {
  readonly cleanedText: string;
  readonly skillReferences: readonly string[];
  readonly toolReferences: readonly string[];
}

export function parsePromptReferences(text: string): PromptReferenceResult {
  const skillReferences: string[] = [];
  const toolReferences: string[] = [];

  const cleanedText = text.replace(
    PROMPT_REFERENCE_PATTERN,
    (_match: string, ...groups: unknown[]): string => {
      const named = groups[groups.length - 1] as Record<string, string>;
      const kind = named.kind;
      const name = named.name.trim();
      if (kind === "skill") {
        skillReferences.push(name);
      } else {
        toolReferences.push(name);
      }
      return "";
    },
  );

  const collapsed = cleanedText
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return Object.freeze({
    cleanedText: collapsed,
    skillReferences: Object.freeze(skillReferences),
    toolReferences: Object.freeze(toolReferences),
  });
}
