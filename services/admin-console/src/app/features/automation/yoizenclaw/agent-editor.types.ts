/**
 * Discriminated union for what the user is currently focused on
 * in the agent builder's left palette.
 */
export type IAgentEditorSelection =
  | { kind: "general" }
  | { kind: "instruction-prompt" }
  | { kind: "instruction-rules" }
  | { kind: "instruction-soul" }
  | { kind: "instruction-mentions" }
  | { kind: "skill"; index: number }
  | { kind: "tool"; index: number };

export const SELECTION_GENERAL: IAgentEditorSelection = { kind: "general" };
export const SELECTION_INSTRUCTION_PROMPT: IAgentEditorSelection = {
  kind: "instruction-prompt",
};
export const SELECTION_INSTRUCTION_RULES: IAgentEditorSelection = {
  kind: "instruction-rules",
};
export const SELECTION_INSTRUCTION_SOUL: IAgentEditorSelection = {
  kind: "instruction-soul",
};
export const SELECTION_INSTRUCTION_MENTIONS: IAgentEditorSelection = {
  kind: "instruction-mentions",
};

export function selectSkill(index: number): IAgentEditorSelection {
  return { kind: "skill", index };
}

export function selectTool(index: number): IAgentEditorSelection {
  return { kind: "tool", index };
}

/**
 * True if the selection is any of the four Instructions sub-items.
 * Used by the palette to highlight the parent group as "active".
 */
export function isInstructionSelection(
  selection: IAgentEditorSelection,
): boolean {
  return (
    selection.kind === "instruction-prompt" ||
    selection.kind === "instruction-rules" ||
    selection.kind === "instruction-soul" ||
    selection.kind === "instruction-mentions"
  );
}

export function isSameSelection(
  a: IAgentEditorSelection,
  b: IAgentEditorSelection,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "skill" && b.kind === "skill") return a.index === b.index;
  if (a.kind === "tool" && b.kind === "tool") return a.index === b.index;
  return true;
}
