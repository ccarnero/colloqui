import { describe, expect, it } from "bun:test";
import { extractTarBundle } from "../../../src/modules/kb/lib/extract-tar-bundle";

const BLOCK_SIZE = 512;
const DEFAULT_OPTIONS = { maxEntryBytes: 1024, maxTotalBytes: 4096 };

/** Builds a single USTAR header block for a regular file entry. This test
 * suite does not exercise checksum verification (the reader doesn't check
 * it), so the checksum field is left as zeros. */
function buildHeaderBlock(name: string, size: number): Buffer {
  const block = Buffer.alloc(BLOCK_SIZE);
  block.write(name, 0, "utf8");
  block.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
  block[156] = "0".charCodeAt(0); // typeflag: regular file
  block.write("ustar\0", 257, "utf8");
  return block;
}

function alignToBlock(size: number): number {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? size : size + (BLOCK_SIZE - remainder);
}

function buildTarEntry(name: string, content: string): Buffer {
  const contentBuffer = Buffer.from(content, "utf8");
  const header = buildHeaderBlock(name, contentBuffer.length);
  const padded = Buffer.alloc(alignToBlock(contentBuffer.length));
  contentBuffer.copy(padded);
  return Buffer.concat([header, padded]);
}

function buildTar(entries: { name: string; content: string }[]): Buffer {
  const parts = entries.map((e) => buildTarEntry(e.name, e.content));
  const endMarker = Buffer.alloc(BLOCK_SIZE * 2);
  return Buffer.concat([...parts, endMarker]);
}

describe("extractTarBundle", () => {
  it("extracts a well-formed single-file archive", () => {
    const tar = buildTar([{ name: "doc.md", content: "hello world" }]);
    const result = extractTarBundle(tar, DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.get("doc.md")?.toString("utf8")).toBe("hello world");
    }
  });

  it("extracts multiple entries preserving relative subdirectory paths", () => {
    const tar = buildTar([
      { name: "docs/a.md", content: "aaa" },
      { name: "docs/b.md", content: "bbb" },
    ]);
    const result = extractTarBundle(tar, DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.size).toBe(2);
      expect(result.value.get("docs/a.md")?.toString("utf8")).toBe("aaa");
      expect(result.value.get("docs/b.md")?.toString("utf8")).toBe("bbb");
    }
  });

  it("rejects an absolute path entry", () => {
    const tar = buildTar([{ name: "/etc/passwd", content: "pwned" }]);
    const result = extractTarBundle(tar, DEFAULT_OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("absolute_path");
    }
  });

  it("rejects a path-traversal entry ('../' escaping the bundle root)", () => {
    const tar = buildTar([{ name: "../../etc/passwd", content: "pwned" }]);
    const result = extractTarBundle(tar, DEFAULT_OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("path_traversal");
    }
  });

  it("rejects a path-traversal entry nested inside a legitimate-looking prefix", () => {
    const tar = buildTar([{ name: "docs/../../secrets.env", content: "x" }]);
    const result = extractTarBundle(tar, DEFAULT_OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("path_traversal");
    }
  });

  it("allows an internal '../' that stays within the bundle root", () => {
    const tar = buildTar([{ name: "docs/sub/../a.md", content: "aaa" }]);
    const result = extractTarBundle(tar, DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.get("docs/a.md")?.toString("utf8")).toBe("aaa");
    }
  });

  it("rejects an entry over the per-entry size cap", () => {
    const tar = buildTar([{ name: "big.txt", content: "x".repeat(2000) }]);
    const result = extractTarBundle(tar, {
      maxEntryBytes: 1024,
      maxTotalBytes: 4096,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("entry_too_large");
    }
  });

  it("rejects a bundle whose total size exceeds the total cap", () => {
    const tar = buildTar([
      { name: "a.txt", content: "x".repeat(600) },
      { name: "b.txt", content: "x".repeat(600) },
    ]);
    const result = extractTarBundle(tar, {
      maxEntryBytes: 1024,
      maxTotalBytes: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("bundle_too_large");
    }
  });

  it("returns an empty map for an empty archive (two zero blocks only)", () => {
    const result = extractTarBundle(
      Buffer.alloc(BLOCK_SIZE * 2),
      DEFAULT_OPTIONS
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.size).toBe(0);
    }
  });
});
