import type { ISkillInfo, IToolInfo } from "./ai.types";

// ---------------------------------------------------------------------------
// Hover provider — shows a description popup when the user hovers
// over @skill:name or @tool:name tokens in the Monaco editor.
// ---------------------------------------------------------------------------

export function registerAiMonacoHoverProvider(opts: {
  getSkills: () => ISkillInfo[];
  getTools: () => IToolInfo[];
}): void {
  const register = () => {
    const w = window as unknown as { monaco?: typeof import("monaco-editor") };
    if (!w.monaco) {
      setTimeout(register, 100);
      return;
    }

    w.monaco.languages.registerHoverProvider("ai-prompt", {
      provideHover: (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber);
        const wordAtPos = model.getWordAtPosition(position);

        if (!wordAtPos) {
          return null;
        }

        const startColumn = wordAtPos.startColumn;
        const word = wordAtPos.word;
        const charBefore =
          startColumn > 1 ? lineContent[startColumn - 2] : "";

        if (charBefore === "@") {
          if (word.startsWith("skill:")) {
            const id = word.substring(6);
            const skill = opts.getSkills().find((s) => s.id === id);
            return {
              contents: [
                { value: `**@skill:${id}**` },
                { value: skill?.description || `Skill: ${id}` },
              ],
            };
          }
          if (word.startsWith("tool:")) {
            const id = word.substring(5);
            const tool = opts.getTools().find((t) => t.id === id);
            return {
              contents: [
                { value: `**@tool:${id}**` },
                { value: tool?.description || `Tool: ${id}` },
              ],
            };
          }
        }

        return null;
      },
    });
  };

  setTimeout(register, 500);
}

// ---------------------------------------------------------------------------
// Completion provider — suggests @skill: and @tool: values as the user types
// ---------------------------------------------------------------------------

type Monaco = typeof import("monaco-editor");

interface ISimpleCompletion {
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
}

export function registerAiMonacoCompletionProvider(opts: {
  getSkills: () => ISkillInfo[];
  getTools: () => IToolInfo[];
}): void {
  const register = () => {
    const w = window as unknown as { monaco?: Monaco };
    const monaco = w.monaco;
    if (!monaco) {
      setTimeout(register, 100);
      return;
    }

    const { CompletionItemKind } = monaco.languages;

    monaco.languages.registerCompletionItemProvider("ai-prompt", {
      triggerCharacters: ["@"],
      provideCompletionItems: (model, position) => {
        const textUntilPosition = model
          .getLineContent(position.lineNumber)
          .substring(0, position.column - 1);

        // Find the last @ that starts a potential reference
        const atIndex = textUntilPosition.lastIndexOf("@");
        if (atIndex < 0) return { suggestions: [] };

        const prefix = textUntilPosition.substring(atIndex + 1);

        // Range covering the @… text being replaced
        const range: ISimpleCompletion["range"] = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: atIndex + 1,
          endColumn: position.column,
        };

        // Nothing after @ → offer the two kind prefixes
        if (prefix.length === 0) {
          return {
            suggestions: [
              { label: "skill:", kind: CompletionItemKind.Keyword, insertText: "skill:", range },
              { label: "tool:", kind: CompletionItemKind.Keyword, insertText: "tool:", range },
            ],
          };
        }

        // @skill:<filter> → offer matching skills
        if (prefix.startsWith("skill:")) {
          const filter = prefix.substring(6).toLowerCase();
          const suggestions = opts
            .getSkills()
            .filter(
              (s) =>
                !filter ||
                s.id.includes(filter) ||
                s.name.toLowerCase().includes(filter),
            )
            .map(
              (s): ISimpleCompletion => ({
                label: `@skill:${s.name}`,
                kind: CompletionItemKind.Function,
                detail: s.description || `Skill: ${s.name}`,
                insertText: "@skill:" + s.id,
                range,
              }),
            );
          return { suggestions };
        }

        // @tool:<filter> → offer matching tools
        if (prefix.startsWith("tool:")) {
          const filter = prefix.substring(5).toLowerCase();
          const suggestions = opts
            .getTools()
            .filter(
              (t) =>
                !filter ||
                t.id.includes(filter) ||
                t.name.toLowerCase().includes(filter),
            )
            .map(
              (t): ISimpleCompletion => ({
                label: `@tool:${t.name}`,
                kind: CompletionItemKind.Function,
                detail: t.description || `Tool: ${t.name}`,
                insertText: "@tool:" + t.id,
                range,
              }),
            );
          return { suggestions };
        }

        // Typing @ followed by a partial kind name — suggest the matching prefix
        const suggestions: ISimpleCompletion[] = [];
        if ("skill:".startsWith(prefix) || "skill".startsWith(prefix)) {
          suggestions.push({
            label: "skill:",
            kind: CompletionItemKind.Keyword,
            insertText: "skill:",
            range,
          });
        }
        if ("tool:".startsWith(prefix) || "tool".startsWith(prefix)) {
          suggestions.push({
            label: "tool:",
            kind: CompletionItemKind.Keyword,
            insertText: "tool:",
            range,
          });
        }
        return { suggestions };
      },
    });
  };

  setTimeout(register, 500);
}

// ---------------------------------------------------------------------------
// Key-up handler — force-trigger suggest when the user types @ (Monaco
// sometimes misses the trigger character depending on editor context).
// ---------------------------------------------------------------------------

function registerAiMonacoTriggerOnAt(): void {
  const register = () => {
    const w = window as unknown as { monaco?: typeof import("monaco-editor") };
    const monaco = w.monaco;
    if (!monaco) {
      setTimeout(register, 100);
      return;
    }

    // Use DOM keyup event instead of monaco.editor.onKeyUp (which
    // does not exist on the namespace — only on editor instances).
    window.addEventListener("keyup", (e: KeyboardEvent) => {
      if (e.key !== "@") return;
      const editor = monaco.editor.getEditors().find((ed) => ed.hasTextFocus());
      if (!editor) return;
      const model = editor.getModel();
      if (!model || model.getLanguageId() !== "ai-prompt") return;
      setTimeout(() => {
        editor.getAction("editor.action.triggerSuggest")?.run();
      }, 10);
    });
  };

  setTimeout(register, 500);
}

registerAiMonacoTriggerOnAt();
