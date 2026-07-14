import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { diffResource } from "../../../src/modules/plan/lib/diff-resource";

describe("diffResource", () => {
  it("returns verdict 'create' when there is no live resource", () => {
    const result = diffResource({ type: "http", direction: "inbound" }, null);
    expect(result.verdict).toBe("create");
    expect(result.diff).toEqual([]);
  });

  it("returns verdict 'noop' when desired and live are structurally equal", () => {
    const result = diffResource(
      { type: "http", config: { a: 1, b: 2 } },
      { type: "http", config: { b: 2, a: 1 } } // key order differs — still equal
    );
    expect(result.verdict).toBe("noop");
    expect(result.diff).toEqual([]);
  });

  it("returns verdict 'update' with one FieldDiff per differing top-level key", () => {
    const result = diffResource(
      { type: "http", direction: "inbound", config: { url: "https://a" } },
      { type: "https", direction: "inbound", config: { url: "https://b" } }
    );
    expect(result.verdict).toBe("update");
    expect(result.diff).toHaveLength(2);
    const fields = result.diff.map((d) => d.field).sort();
    expect(fields).toEqual(["config", "type"]);
  });

  it("treats a key present only on the live side as a diff", () => {
    const result = diffResource(
      { type: "http" },
      { type: "http", legacyField: "should-not-exist-in-manifest" }
    );
    expect(result.verdict).toBe("update");
    expect(result.diff).toEqual([
      {
        field: "legacyField",
        current: "should-not-exist-in-manifest",
        desired: undefined,
      },
    ]);
  });

  it("array-valued fields are order-sensitive", () => {
    const result = diffResource(
      { env: [{ name: "A" }, { name: "B" }] },
      { env: [{ name: "B" }, { name: "A" }] }
    );
    expect(result.verdict).toBe("update");
  });
});
