import assert from "node:assert/strict";
import { test } from "node:test";
import { extractManifestName } from "./extract-manifest-name.js";

test("extractManifestName() returns metadata.name when present", () => {
  const result = extractManifestName({ metadata: { name: "support-bot" } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, "support-bot");
  }
});

test("extractManifestName() errors when 'metadata' is missing", () => {
  const result = extractManifestName({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /missing a 'metadata' object/);
  }
});

test("extractManifestName() errors when 'metadata.name' is missing or empty", () => {
  const result = extractManifestName({ metadata: { name: "" } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /metadata\.name/);
  }
});
