import { splitVariablePath } from "../split-variable-path";

describe("splitVariablePath", () => {
  it("splits a dotted path into a dimmed root and an emphasized leaf", () => {
    expect(splitVariablePath("results.buildAgentContext.tier")).toEqual({
      root: "results.buildAgentContext.",
      leaf: "tier",
    });
  });

  it("returns an empty root for a single-segment path", () => {
    expect(splitVariablePath("tier")).toEqual({ root: "", leaf: "tier" });
  });

  it("returns empty root/leaf for an empty path (placeholder-bug regression: the pill still calls this, never crashes)", () => {
    expect(splitVariablePath("")).toEqual({ root: "", leaf: "" });
  });

  it("trims surrounding whitespace before splitting", () => {
    expect(splitVariablePath("  request.text  ")).toEqual({
      root: "request.",
      leaf: "text",
    });
  });
});
