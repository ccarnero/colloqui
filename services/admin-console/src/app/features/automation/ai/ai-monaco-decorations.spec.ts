import { describe, expect, it, vi } from "vitest";
import {
  buildMentionDecorations,
  computeMentionDecorationRanges,
  type IMentionDecorationEditor,
  registerAiMonacoMentionDecorations,
} from "./ai-monaco-decorations";

describe("computeMentionDecorationRanges", () => {
  it("finds a mention at the start of the text", () => {
    const text = "@skill:lead-scoring, then escalate.";
    const ranges = computeMentionDecorationRanges(text);
    expect(ranges).toEqual([{ kind: "skill", startOffset: 0, endOffset: 19 }]);
    expect(text.slice(0, 19)).toBe("@skill:lead-scoring");
  });

  it("finds a mention in the middle of the text", () => {
    const text = "Score using @skill:lead-scoring, then escalate.";
    const ranges = computeMentionDecorationRanges(text);
    expect(ranges).toEqual([{ kind: "skill", startOffset: 12, endOffset: 31 }]);
    expect(text.slice(12, 31)).toBe("@skill:lead-scoring");
  });

  it("finds a mention at the end of the text", () => {
    const text = "Escalate via @tool:crm-create-opportunity";
    const ranges = computeMentionDecorationRanges(text);
    expect(ranges).toEqual([{ kind: "tool", startOffset: 13, endOffset: 41 }]);
    expect(text.slice(13, 41)).toBe("@tool:crm-create-opportunity");
  });

  it("finds adjacent mentions separated by punctuation", () => {
    const text = "@skill:alpha, @tool:beta.";
    const ranges = computeMentionDecorationRanges(text);
    expect(ranges).toEqual([
      { kind: "skill", startOffset: 0, endOffset: 12 },
      { kind: "tool", startOffset: 14, endOffset: 24 },
    ]);
    expect(text.slice(0, 12)).toBe("@skill:alpha");
    expect(text.slice(14, 24)).toBe("@tool:beta");
  });

  // Regression: mirrors the shared regex's real (non-obvious) behavior —
  // when two mentions sit back-to-back with only a space between them and
  // no punctuation/stop-word, the first one's non-greedy name group swallows
  // toward the second "@" but "@" isn't in the name character class, so the
  // WHOLE first match fails and only the second (tool) mention is found.
  // This must be reproduced exactly, not "fixed", per SPEC decision 2.
  it("drops an unpunctuated adjacent mention exactly like the shared parser", () => {
    const text = "@skill:lead-scoring @tool:crm-create-opportunity";
    const ranges = computeMentionDecorationRanges(text);
    expect(ranges).toEqual([{ kind: "tool", startOffset: 20, endOffset: 48 }]);
    expect(text.slice(20, 48)).toBe("@tool:crm-create-opportunity");
  });

  it("does not match @skill: with no id at all (immediate punctuation)", () => {
    const text = "Reference @skill:.";
    expect(computeMentionDecorationRanges(text)).toEqual([]);
  });

  it("filters out @skill: whose captured id is whitespace-only", () => {
    const text = "Reference @skill: ";
    expect(computeMentionDecorationRanges(text)).toEqual([]);
  });

  it("ignores a dangling @ with no kind/colon", () => {
    const text = "Email me @ noon about this.";
    expect(computeMentionDecorationRanges(text)).toEqual([]);
  });

  it("returns no ranges when there are no mentions", () => {
    const text = "Just a plain instruction with no references.";
    expect(computeMentionDecorationRanges(text)).toEqual([]);
  });

  it("captures multi-word / hyphenated names per the shared regex", () => {
    const text = "Use @skill:lead scoring helper for this.";
    const ranges = computeMentionDecorationRanges(text);
    expect(ranges).toEqual([{ kind: "skill", startOffset: 4, endOffset: 30 }]);
    // Reproduces the exact stop-word boundary of the shared regex: capture
    // stops right before " for " because "for" is a recognized stop word.
    expect(text.slice(4, 30)).toBe("@skill:lead scoring helper");
  });
});

describe("buildMentionDecorations", () => {
  it("converts offsets to Monaco range objects via getPositionAt", () => {
    const ranges = [
      { kind: "skill" as const, startOffset: 0, endOffset: 19 },
      { kind: "tool" as const, startOffset: 20, endOffset: 30 },
    ];
    const model = {
      getPositionAt: vi.fn((offset: number) => ({
        lineNumber: 1,
        column: offset + 1,
      })),
    };

    const decorations = buildMentionDecorations(ranges, model);

    expect(decorations).toEqual([
      {
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 20,
        },
        options: { inlineClassName: "ai-mention-decoration-skill" },
      },
      {
        range: {
          startLineNumber: 1,
          startColumn: 21,
          endLineNumber: 1,
          endColumn: 31,
        },
        options: { inlineClassName: "ai-mention-decoration-tool" },
      },
    ]);
  });
});

function createMockEditor(initialText: string): {
  editor: IMentionDecorationEditor;
  setText: (next: string) => void;
  changeListeners: Array<() => void>;
} {
  let text = initialText;
  const changeListeners: Array<() => void> = [];
  const disposeListeners: Array<() => void> = [];

  const model = {
    getValue: () => text,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
  };

  const editor: IMentionDecorationEditor = {
    getModel: () => model,
    deltaDecorations: vi.fn((_old: string[], decos) =>
      decos.map((_d: unknown, i: number) => `deco-${i}`)
    ),
    onDidChangeModelContent: (listener: () => void) => {
      changeListeners.push(listener);
      return { dispose: vi.fn() };
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: vi.fn() };
    },
  };

  return {
    editor,
    setText: (next: string) => {
      text = next;
      for (const listener of changeListeners) {
        listener();
      }
    },
    changeListeners,
  };
}

describe("registerAiMonacoMentionDecorations", () => {
  it("applies initial decorations on registration", () => {
    const { editor } = createMockEditor("@skill:lead-scoring, active.");
    registerAiMonacoMentionDecorations(editor);

    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);
    const [, decorations] = (
      editor.deltaDecorations as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(decorations).toHaveLength(1);
  });

  it("recomputes decorations on model content change", () => {
    const { editor, setText } = createMockEditor("no mentions here");
    registerAiMonacoMentionDecorations(editor);

    expect(editor.deltaDecorations).toHaveBeenCalledTimes(1);

    setText("now with @tool:crm-create-opportunity added");

    expect(editor.deltaDecorations).toHaveBeenCalledTimes(2);
    const secondCallArgs = (editor.deltaDecorations as ReturnType<typeof vi.fn>)
      .mock.calls[1];
    expect(secondCallArgs[1]).toHaveLength(1);
  });

  it("disposes listeners and clears decorations on dispose()", () => {
    const { editor } = createMockEditor("@skill:alpha, used.");
    const registration = registerAiMonacoMentionDecorations(editor);

    registration.dispose();

    const calls = (editor.deltaDecorations as ReturnType<typeof vi.fn>).mock
      .calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toEqual([]);
  });
});
