import { describe, expect, it } from "bun:test";
import { resolveMcpToolDescriptionOverride } from "../../src/modules/tools/resolve-mcp-tool-description-override";

describe("resolveMcpToolDescriptionOverride", () => {
  it("returns undefined when overrides map is null", () => {
    expect(
      resolveMcpToolDescriptionOverride(null, "srv__tool")
    ).toBeUndefined();
  });

  it("returns undefined when overrides map is undefined", () => {
    expect(
      resolveMcpToolDescriptionOverride(undefined, "srv__tool")
    ).toBeUndefined();
  });

  it("resolves via the sanitized key when present", () => {
    const result = resolveMcpToolDescriptionOverride(
      { srv__tool: "override text" },
      "srv__tool"
    );
    expect(result).toBe("override text");
  });

  it("returns undefined when the key is not present", () => {
    const result = resolveMcpToolDescriptionOverride(
      { unrelated: "x" },
      "srv__tool"
    );
    expect(result).toBeUndefined();
  });

  it("treats an empty-string override as no override", () => {
    const result = resolveMcpToolDescriptionOverride(
      { srv__tool: "" },
      "srv__tool"
    );
    expect(result).toBeUndefined();
  });
});
