import { describe, expect, it } from "bun:test";
import { decideDocumentAction } from "../../../src/modules/kb/lib/decide-document-action";

describe("decideDocumentAction", () => {
  it("returns 'create' when no checksum was ever stored", () => {
    expect(decideDocumentAction(undefined, "abc123")).toBe("create");
  });

  it("returns 'skip' when the stored checksum matches the current one", () => {
    expect(decideDocumentAction("abc123", "abc123")).toBe("skip");
  });

  it("returns 'reembed' when the stored checksum differs from the current one", () => {
    expect(decideDocumentAction("abc123", "def456")).toBe("reembed");
  });
});
