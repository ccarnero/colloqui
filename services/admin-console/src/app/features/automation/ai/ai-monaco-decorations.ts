import { createMentionRegex } from "./ai.helpers";

// ---------------------------------------------------------------------------
// Mention decorations — highlights @skill:<id> / @tool:<id> tokens inline in
// the Monaco "ai-prompt" editors (System Prompt / Rules / Soul).
//
// DISPLAY-LAYER ONLY (SPEC decision 2): this module never touches the model
// text or the save path — it only reads `model.getValue()` to compute
// decoration ranges and calls `deltaDecorations` to paint them. The stored
// prompt string is completely untouched.
// ---------------------------------------------------------------------------

export type MentionKind = "skill" | "tool";

export interface IMentionDecorationRange {
  kind: MentionKind;
  /** Character offset in the model text, inclusive. */
  startOffset: number;
  /** Character offset in the model text, exclusive. */
  endOffset: number;
}

/**
 * Parses `text` with the EXACT mention regex from `ai.helpers.ts`
 * (`createMentionRegex`) and returns the character offsets of every
 * recognized `@skill:<id>` / `@tool:<id>` mention. Reuses the same
 * non-greedy/stop-word boundary logic as `extractMentionsFromPrompt` — it
 * must never diverge into a naive word-boundary match.
 */
export function computeMentionDecorationRanges(
  text: string
): IMentionDecorationRange[] {
  const regex = createMentionRegex();
  const ranges: IMentionDecorationRange[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const kindRaw = match[1].toLowerCase();
    const kind: MentionKind = kindRaw === "skill" ? "skill" : "tool";
    const name = match[2];

    // Malformed guard: "@skill:" with no captured id (regex requires 1+
    // chars, but an all-whitespace capture is effectively an empty id).
    if (!name || !name.trim()) {
      continue;
    }

    const startOffset = match.index;
    // "@" + kind + ":" is the literal prefix preceding the captured name.
    const prefixLength = 1 + match[1].length + 1;
    const endOffset = startOffset + prefixLength + name.length;

    ranges.push({ kind, startOffset, endOffset });
  }

  console.debug(
    `[ai-monaco-decorations] parsed ${ranges.length} mention(s) from ${text.length} chars`
  );

  return ranges;
}

/** Minimal shape of the Monaco text model methods this module depends on. */
export interface IMentionDecorationModel {
  getPositionAt(offset: number): { lineNumber: number; column: number };
}

/** Minimal shape of a Monaco `IModelDeltaDecoration`. */
export interface IMonacoDeltaDecoration {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  options: { inlineClassName: string };
}

const DECORATION_CLASS_BY_KIND: Record<MentionKind, string> = {
  skill: "ai-mention-decoration-skill",
  tool: "ai-mention-decoration-tool",
};

/**
 * Converts parsed mention ranges (character offsets) into Monaco
 * `deltaDecorations`-ready range objects, using the model's own
 * `getPositionAt` for offset-to-line/column conversion so multi-line
 * prompts are handled correctly.
 */
export function buildMentionDecorations(
  ranges: IMentionDecorationRange[],
  model: IMentionDecorationModel
): IMonacoDeltaDecoration[] {
  return ranges.map((r) => {
    const start = model.getPositionAt(r.startOffset);
    const end = model.getPositionAt(r.endOffset);
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      options: { inlineClassName: DECORATION_CLASS_BY_KIND[r.kind] },
    };
  });
}

/** Minimal shape of a Monaco standalone code editor this module depends on. */
export interface IMentionDecorationEditor {
  getModel(): (IMentionDecorationModel & { getValue(): string }) | null;
  deltaDecorations(
    oldDecorations: string[],
    newDecorations: IMonacoDeltaDecoration[]
  ): string[];
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  onDidDispose(listener: () => void): { dispose(): void };
}

/**
 * Wires mention decorations for one Monaco editor instance: paints the
 * initial decorations, recomputes them on every content change, and cleans
 * up listeners + decorations on dispose. Returns a `dispose()` callback the
 * caller MUST invoke on component teardown (in addition to Monaco's own
 * `onDidDispose`, as a defensive double-cleanup).
 */
export function registerAiMonacoMentionDecorations(
  editor: IMentionDecorationEditor
): { dispose(): void } {
  let decorationIds: string[] = [];
  let recomputeCount = 0;

  const recompute = (): void => {
    const model = editor.getModel();
    if (!model) {
      console.debug("[ai-monaco-decorations] recompute skipped: no model");
      return;
    }

    const ranges = computeMentionDecorationRanges(model.getValue());
    const decorations = buildMentionDecorations(ranges, model);
    decorationIds = editor.deltaDecorations(decorationIds, decorations);
    recomputeCount += 1;

    console.debug(
      `[ai-monaco-decorations] recompute #${recomputeCount}: ${decorations.length} decoration(s) applied`
    );
  };

  recompute();

  const changeSub = editor.onDidChangeModelContent(() => recompute());
  const disposeSub = editor.onDidDispose(() => {
    changeSub.dispose();
    decorationIds = editor.deltaDecorations(decorationIds, []);
  });

  return {
    dispose(): void {
      changeSub.dispose();
      disposeSub.dispose();
      decorationIds = editor.deltaDecorations(decorationIds, []);
      console.debug("[ai-monaco-decorations] disposed");
    },
  };
}
