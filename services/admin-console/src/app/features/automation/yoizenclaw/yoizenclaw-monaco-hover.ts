import type { ISkillInfo, IToolInfo } from "./yoizenclaw.types";

export function registerYoizenclawMonacoHoverProvider(opts: {
  getSkills: () => ISkillInfo[];
  getTools: () => IToolInfo[];
}): void {
  const checkMonaco = () => {
    const w = window as unknown as { monaco?: typeof import("monaco-editor") };
    if (w.monaco) {
      w.monaco.languages.registerHoverProvider("yoizenclaw-prompt", {
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
    } else {
      setTimeout(checkMonaco, 100);
    }
  };

  setTimeout(checkMonaco, 500);
}
