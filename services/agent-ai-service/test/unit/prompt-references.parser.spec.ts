import { describe, it, expect } from "bun:test";
import { parsePromptReferences } from "../../src/modules/prompt-references/prompt-references.parser";

describe("PromptReferencesParser", () => {
  // ─── No references ───────────────────────────────────────────────────────

  it("should return empty result for plain text without references", () => {
    const result = parsePromptReferences("Hello world");
    expect(result.cleanedText).toBe("Hello world");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
  });

  it("should ignore @-mentions that are not skill or tool references", () => {
    const result = parsePromptReferences("Hello @user, check @channel for updates");
    expect(result.cleanedText).toBe("Hello @user, check @channel for updates");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
  });

  it("should ignore plain @ symbols not followed by skill/tool", () => {
    const result = parsePromptReferences("Contact @support for help");
    expect(result.cleanedText).toBe("Contact @support for help");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
  });

  // ─── Single reference ────────────────────────────────────────────────────

  it("should extract a single @skill reference and remove it from cleaned text", () => {
    const result = parsePromptReferences("You can use @skill:deploy_skill to deploy");
    expect(result.skillReferences).toEqual(["deploy_skill"]);
    expect(result.toolReferences).toEqual([]);
    expect(result.cleanedText).toBe("You can use deploy");
  });

  it("should extract a single @tool reference and remove it from cleaned text", () => {
    const result = parsePromptReferences("Use @tool:communicate to message");
    expect(result.toolReferences).toEqual(["communicate"]);
    expect(result.skillReferences).toEqual([]);
    expect(result.cleanedText).toBe("Use message");
  });

  // ─── Multiple references ─────────────────────────────────────────────────

  it("should extract multiple references of the same kind", () => {
    const result = parsePromptReferences("Run @skill:deploy and @skill:analyze");
    expect(result.skillReferences).toEqual(["deploy", "analyze"]);
    expect(result.toolReferences).toEqual([]);
    // " and " is consumed as the stop‑word boundary after "deploy"
    expect(result.cleanedText).toBe("Run");
  });

  it("should extract multiple references of different kinds", () => {
    const result = parsePromptReferences("Use @skill:deploy and @tool:chat and @skill:analyze");
    expect(result.skillReferences).toEqual(["deploy", "analyze"]);
    expect(result.toolReferences).toEqual(["chat"]);
    expect(result.cleanedText).toBe("Use");
  });

  it("should extract trailing reference when adjacent to an unmatched reference", () => {
    // @skill:a is not followed by a stop‑word / punctuation / EOS, so it is
    // not matched. @tool:b sits at EOS so it is matched.
    const result = parsePromptReferences("@skill:a @tool:b");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual(["b"]);
    expect(result.cleanedText).toBe("@skill:a");
  });

  // ─── Names with special characters ───────────────────────────────────────

  it("should support reference names with underscores", () => {
    const result = parsePromptReferences("Use @skill:my_skill_name");
    expect(result.skillReferences).toEqual(["my_skill_name"]);
    expect(result.cleanedText).toBe("Use");
  });

  it("should support reference names with hyphens", () => {
    const result = parsePromptReferences("Call @tool:my-tool");
    expect(result.toolReferences).toEqual(["my-tool"]);
    expect(result.cleanedText).toBe("Call");
  });

  it("should support reference names with mixed hyphens, underscores, and digits", () => {
    const result = parsePromptReferences("Use @skill:my_cool-tool_42");
    expect(result.skillReferences).toEqual(["my_cool-tool_42"]);
    expect(result.cleanedText).toBe("Use");
  });

  it("should support uppercase reference names", () => {
    const result = parsePromptReferences("@skill:DEPLOY_TOOL");
    expect(result.skillReferences).toEqual(["DEPLOY_TOOL"]);
  });

  // ─── Edge: empty and degenerate inputs ───────────────────────────────────

  it("should handle empty string input", () => {
    const result = parsePromptReferences("");
    expect(result.cleanedText).toBe("");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
  });

  it("should handle input with only whitespace", () => {
    const result = parsePromptReferences("   \n\n  ");
    expect(result.cleanedText).toBe("");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
  });

  it("should handle input with only a single reference", () => {
    const result = parsePromptReferences("@skill:test");
    expect(result.cleanedText).toBe("");
    expect(result.skillReferences).toEqual(["test"]);
    expect(result.toolReferences).toEqual([]);
  });

  it("should handle input with multiple adjacent references leaving only whitespace after removal", () => {
    // @skill:a is followed by three spaces then @skill:b — no stop‑word,
    // no punctuation, not EOS → unmatched. @skill:b at EOS is matched.
    const result = parsePromptReferences("@skill:a   @skill:b");
    expect(result.skillReferences).toEqual(["b"]);
    expect(result.toolReferences).toEqual([]);
    expect(result.cleanedText).toBe("@skill:a");
  });

  it("should handle input with references and no surrounding text", () => {
    // @skill:a is immediately followed by @ — no stop‑word, punctuation, or
    // EOS → unmatched. @tool:b at EOS is matched.
    const result = parsePromptReferences("@skill:a@tool:b");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual(["b"]);
    expect(result.cleanedText).toBe("@skill:a");
  });

  // ─── Reference positions ─────────────────────────────────────────────────

  it("should handle reference at the start of text", () => {
    const result = parsePromptReferences("@skill:start and then middle");
    expect(result.skillReferences).toEqual(["start"]);
    expect(result.cleanedText).toBe("then middle");
  });

  it("should handle reference at the end of text", () => {
    const result = parsePromptReferences("middle and then @tool:end");
    expect(result.toolReferences).toEqual(["end"]);
    expect(result.cleanedText).toBe("middle and then");
  });

  it("should handle references at both start and end", () => {
    const result = parsePromptReferences("@skill:start and @tool:end");
    expect(result.skillReferences).toEqual(["start"]);
    expect(result.toolReferences).toEqual(["end"]);
    expect(result.cleanedText).toBe("");
  });

  // ─── Whitespace normalization ────────────────────────────────────────────

  it("should collapse multiple spaces into a single space in cleaned text", () => {
    // @skill:foo is followed by "   and   now" — " and " is a stop‑word
    // boundary, so the reference is matched and the surrounding whitespace
    // gets collapsed.
    const result = parsePromptReferences("Use   @skill:foo   and   now");
    expect(result.skillReferences).toEqual(["foo"]);
    expect(result.toolReferences).toEqual([]);
    // After removing "@skill:foo   and ": "Use     now" (3+2 spaces)
    // → collapsed to: "Use now"
    expect(result.cleanedText).toBe("Use now");
  });

  it("should handle multiple spaces and newlines", () => {
    const result = parsePromptReferences("Line1\n\n\n@skill:foo\n\n\nLine2");
    expect(result.skillReferences).toEqual(["foo"]);
    // After removal: "Line1\n\n\n\n\n\nLine2" (two groups of 3 newlines = 6 newlines)
    // Wait: "Line1\n\n\n@skill:foo\n\n\nLine2"
    // After removing "@skill:foo": "Line1\n\n\n\n\n\nLine2"
    // \n{3,} matches first 3 → "\n\n", then next 3 → "\n\n" → "Line1\n\n\n\nLine2"
    // No, actually replace with global flag:
    // "Line1\n\n\n\n\n\nLine2" — one match of \n{3,}??? No, \n{3,} matches 3+ newlines
    // This string has 6 consecutive newlines. \n{3,} matches all 6 as one match.
    // Replaced with "\n\n" → "Line1\n\nLine2"
    // Trim → "Line1\n\nLine2"
    expect(result.cleanedText).toBe("Line1\n\nLine2");
  });

  it("should collapse horizontal tabs and spaces", () => {
    const result = parsePromptReferences("a\t\tb\t\tc");
    expect(result.cleanedText).toBe("a b c");
  });

  it("should trim leading and trailing whitespace from cleaned text", () => {
    const result = parsePromptReferences("   \n  @skill:foo   ");
    expect(result.skillReferences).toEqual(["foo"]);
    expect(result.cleanedText).toBe("");
  });

  // ─── Multiple references scattered with whitespace ───────────────────────

  it("should extract references separated by newlines and collapse whitespace correctly", () => {
    const result = parsePromptReferences(
      "First\n\n@skill:analyze\n\n@tool:report\n\nLast",
    );
    expect(result.skillReferences).toEqual(["analyze"]);
    expect(result.toolReferences).toEqual(["report"]);
    // Original: "First\n\n@skill:analyze\n\n@tool:report\n\nLast"
    // After removing @skill:analyze: "First\n\n\n\n@tool:report\n\nLast"
    // After removing @tool:report: "First\n\n\n\n\n\nLast"  (6 consecutive \n)
    // \n{3,} matches all 6 as one group → replaced with "\n\n"
    // Result: "First\n\nLast"
    expect(result.cleanedText).toBe("First\n\nLast");
  });

  // ─── Frozen object (immutability) ────────────────────────────────────────

  it("should return a frozen object (Object.freeze)", () => {
    const result = parsePromptReferences("@skill:foo @tool:bar");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("should return frozen skillReferences array", () => {
    const result = parsePromptReferences("@skill:foo @skill:bar");
    expect(Object.isFrozen(result.skillReferences)).toBe(true);
  });

  it("should return frozen toolReferences array", () => {
    const result = parsePromptReferences("@tool:baz @tool:qux");
    expect(Object.isFrozen(result.toolReferences)).toBe(true);
  });

  // ─── TypeScript type contract ───────────────────────────────────────────

  it("should satisfy the PromptReferenceResult interface contract", () => {
    const result = parsePromptReferences("some text");
    // All properties should be present with correct types
    expect(result).toHaveProperty("cleanedText");
    expect(result).toHaveProperty("skillReferences");
    expect(result).toHaveProperty("toolReferences");
    expect(typeof result.cleanedText).toBe("string");
    expect(Array.isArray(result.skillReferences)).toBe(true);
    expect(Array.isArray(result.toolReferences)).toBe(true);
  });

  // ─── No false positives ──────────────────────────────────────────────────

  it("should not match @skill or @tool without a colon", () => {
    const result = parsePromptReferences("Use @skill and @tool separately");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
    expect(result.cleanedText).toBe("Use @skill and @tool separately");
  });

  it("should not match @skill: or @tool: without a valid name", () => {
    // A colon or symbol after the prefix is not a valid name character
    const result = parsePromptReferences("Use @skill:: or @tool::");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
    expect(result.cleanedText).toBe("Use @skill:: or @tool::");
  });

  it("should not match partial words like notification or toolkit", () => {
    const result = parsePromptReferences("Send a notification with the toolkit");
    expect(result.skillReferences).toEqual([]);
    expect(result.toolReferences).toEqual([]);
    expect(result.cleanedText).toBe("Send a notification with the toolkit");
  });

  it("should not match invalid kind prefixes", () => {
    const result = parsePromptReferences("Use @invalid:test and @skill:valid");
    expect(result.skillReferences).toEqual(["valid"]);
    expect(result.toolReferences).toEqual([]);
    expect(result.cleanedText).toBe("Use @invalid:test and");
  });

  // ─── Preservation of non-reference content ──────────────────────────────

  it("should preserve urls and other special characters in cleaned text", () => {
    const text = "Check https://example.com?q=1 or email test@example.com @skill:validate";
    const result = parsePromptReferences(text);
    expect(result.skillReferences).toEqual(["validate"]);
    expect(result.cleanedText).toBe("Check https://example.com?q=1 or email test@example.com");
  });

  it("should preserve punctuation around removed references", () => {
    // @skill:deploy is followed by ") now!" — `)` is not a recognised boundary
    // character in [,.!?;:\n], so the reference stays unmatched.
    const result = parsePromptReferences("Run (@skill:deploy) now!");
    expect(result.skillReferences).toEqual([]);
    expect(result.cleanedText).toBe("Run (@skill:deploy) now!");
  });
});
