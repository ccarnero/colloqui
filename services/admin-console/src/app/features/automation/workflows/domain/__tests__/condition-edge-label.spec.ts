import { conditionEdgeLabel } from "../flow-deserializer";

/**
 * `conditionEdgeLabel` is exported (SPEC console-redesign-builder-v2
 * IF-editor task) so the conditional branch config panel's expression chip
 * reuses the SAME formatting rule as the canvas edge label — this spec
 * pins the exact output format the panel's `exprChipFor()` depends on.
 */
describe("conditionEdgeLabel", () => {
  it("formats variable + comparator + quoted value", () => {
    expect(
      conditionEdgeLabel({
        variable: "results.buildAgentContext.tier",
        comparator: "eq",
        value: "vip",
      })
    ).toBe('results.buildAgentContext.tier eq "vip"');
  });

  it("returns undefined when variable is not a string (malformed condition)", () => {
    expect(
      conditionEdgeLabel({
        variable: undefined,
        comparator: "eq",
        value: "vip",
      })
    ).toBeUndefined();
  });

  it("returns undefined for a malformed/undefined condition", () => {
    expect(conditionEdgeLabel(undefined)).toBeUndefined();
  });
});
