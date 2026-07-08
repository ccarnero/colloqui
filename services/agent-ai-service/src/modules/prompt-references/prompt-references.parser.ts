/**
 * Prompt reference parsing helpers for agent prompts.
 *
 * Extracts `@skill:` and `@tool:` references from prompt text and returns
 * the cleaned text with those references stripped.
 */

// A reference name is a SINGLE token: letters, digits, underscore or hyphen,
// never a space. The name stops at the first character that can't be part of
// it, so `@skill:deploy now to deploy` yields the name `deploy` (not
// `deploy now`) and leaves the rest of the sentence intact. A reference is
// always recognised regardless of what follows it, and ONLY the reference
// token itself is removed — surrounding words (including connectives like
// `to`/`and`) are preserved; runs of whitespace are collapsed afterwards.
const PROMPT_REFERENCE_PATTERN =
  /@(?<kind>skill|tool):(?<name>[A-Za-z0-9_-]+)/g;

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
    }
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
