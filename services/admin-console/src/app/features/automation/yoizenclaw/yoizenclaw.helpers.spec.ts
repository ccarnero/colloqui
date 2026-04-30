import { describe, it, expect } from "vitest";
import {
  extractMentionsFromPrompt,
  formatHttpErrorMessage,
} from "./yoizenclaw.helpers";

describe("yoizenclaw.helpers", () => {
  it("formatHttpErrorMessage joins array messages", () => {
    expect(formatHttpErrorMessage(["a", "b"], "x")).toBe("a, b");
    expect(formatHttpErrorMessage("one", "x")).toBe("one");
    expect(formatHttpErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("extractMentionsFromPrompt dedupes matches", () => {
    const text = "run @tool:alpha and @tool:alpha";
    expect(extractMentionsFromPrompt(text)).toEqual(["@tool:alpha"]);
  });
});
