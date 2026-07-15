import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readManifestFile } from "./read-manifest-file.js";

function withTempFile(contents: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "yoizen-cli-test-"));
  const path = join(dir, "manifest.yaml");
  writeFileSync(path, contents, "utf8");
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readManifestFile() parses a valid YAML manifest into an object", () => {
  withTempFile(
    "apiVersion: yoizen.io/v1\nkind: IntegrationManifest\nmetadata:\n  name: sample\n",
    (path) => {
      const result = readManifestFile(path);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.kind, "IntegrationManifest");
        assert.deepEqual(result.value.metadata, { name: "sample" });
      }
    }
  );
});

test("readManifestFile() returns a CliError for a missing file", () => {
  const result = readManifestFile("/nonexistent/path/manifest.yaml");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /could not read manifest file/);
  }
});

test("readManifestFile() returns a CliError when the YAML parses to a non-object (e.g. a plain list)", () => {
  withTempFile("- one\n- two\n", (path) => {
    const result = readManifestFile(path);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error.message, /must parse to a YAML\/JSON object/);
    }
  });
});
