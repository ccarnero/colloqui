import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScopeArg } from "./parse-scope-arg.js";

test("parseScopeArg() parses '<kind>:<owner>'", () => {
  const result = parseScopeArg("connector:openai");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, { kind: "connector", owner: "openai" });
  }
});

test("parseScopeArg() errors when there is no ':' separator", () => {
  const result = parseScopeArg("connector-openai");
  assert.equal(result.ok, false);
});

test("parseScopeArg() errors on an unknown scope kind", () => {
  const result = parseScopeArg("bogus:openai");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /kind must be one of/);
  }
});

test("parseScopeArg() rejects scope kind 'skill' (T01, manual-loops/provisioning-manifest-gaps-3.md — deliberately omitted from VALID_SCOPE_KINDS, like systemVariable)", () => {
  const result = parseScopeArg("skill:refund-policy-expert");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /kind must be one of/);
  }
});

test("parseScopeArg() allows an owner value that itself contains ':'", () => {
  const result = parseScopeArg("service:owner:with:colons");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.owner, "owner:with:colons");
  }
});
