import { describe, expect, it } from "bun:test";
import { computeSha256 } from "../../../src/modules/kb/lib/compute-sha256";
import {
  KB_FILE_SOURCE_MAX_BYTES,
  resolveInlineOrFileSource,
} from "../../../src/modules/kb/lib/resolve-kb-document-source";

describe("resolveInlineOrFileSource", () => {
  it("resolves an inline source to its utf8 bytes and sha256", () => {
    const result = resolveInlineOrFileSource(
      { type: "inline", content: "hello world" },
      undefined
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uploadMode).toBe("text");
      expect(result.value.sha256).toBe(computeSha256("hello world"));
    }
  });

  it("resolves a file source from the bundle when the checksum matches", () => {
    const content = Buffer.from("file bytes", "utf8");
    const bundle = new Map([["docs/a.pdf", content]]);
    const result = resolveInlineOrFileSource(
      { type: "file", path: "docs/a.pdf", sha256: computeSha256(content) },
      bundle
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uploadMode).toBe("file");
      expect(result.value.bytes.toString("utf8")).toBe("file bytes");
    }
  });

  it("fails when the file source path is not present in the bundle", () => {
    const result = resolveInlineOrFileSource(
      { type: "file", path: "missing.pdf", sha256: "a".repeat(64) },
      new Map()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("file_not_in_bundle");
    }
  });

  it("fails when the bundle content doesn't match the manifest-declared sha256", () => {
    const content = Buffer.from("actual bytes", "utf8");
    const bundle = new Map([["docs/a.pdf", content]]);
    const result = resolveInlineOrFileSource(
      { type: "file", path: "docs/a.pdf", sha256: "0".repeat(64) },
      bundle
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("file_checksum_mismatch");
    }
  });

  it("fails when the file source exceeds the per-file size cap", () => {
    const oversized = Buffer.alloc(KB_FILE_SOURCE_MAX_BYTES + 1, "a");
    const bundle = new Map([["docs/huge.pdf", oversized]]);
    const result = resolveInlineOrFileSource(
      {
        type: "file",
        path: "docs/huge.pdf",
        sha256: computeSha256(oversized),
      },
      bundle
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("file_too_large");
    }
  });
});
