import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSecretsFromEnv } from "./resolve-secrets-from-env.js";

const bindingA = {
  name: "secret-a",
  scope: { kind: "connector" as const, owner: "x" },
};
const bindingB = {
  name: "secret-b",
  scope: { kind: "channel" as const, owner: "y" },
};

test("resolveSecretsFromEnv() resolves each binding's value from the identically-named env var", () => {
  const result = resolveSecretsFromEnv([bindingA, bindingB], {
    "secret-a": "value-a",
    "secret-b": "value-b",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [
      { ...bindingA, value: "value-a" },
      { ...bindingB, value: "value-b" },
    ]);
  }
});

test("resolveSecretsFromEnv() fails fast listing ALL missing env vars at once, not one at a time", () => {
  const result = resolveSecretsFromEnv([bindingA, bindingB], {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /secret-a/);
    assert.match(result.error.message, /secret-b/);
    assert.deepEqual(result.error.details, {
      missing: ["secret-a", "secret-b"],
    });
  }
});

test("resolveSecretsFromEnv() treats an empty-string env var as missing", () => {
  const result = resolveSecretsFromEnv([bindingA], { "secret-a": "" });
  assert.equal(result.ok, false);
});

test("resolveSecretsFromEnv() falls back to the UPPER_SNAKE form of the binding name (2026-08-11 ruling: shells cannot export hyphenated names)", () => {
  const result = resolveSecretsFromEnv([bindingA, bindingB], {
    SECRET_A: "value-a-snake",
    SECRET_B: "value-b-snake",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [
      { ...bindingA, value: "value-a-snake" },
      { ...bindingB, value: "value-b-snake" },
    ]);
  }
});

test("resolveSecretsFromEnv() lets the exact hyphenated name win over the UPPER_SNAKE fallback when both are set", () => {
  const result = resolveSecretsFromEnv([bindingA], {
    "secret-a": "exact-wins",
    SECRET_A: "fallback-loses",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value[0]?.value, "exact-wins");
  }
});

test("resolveSecretsFromEnv() falls back when the exact name is set but empty", () => {
  const result = resolveSecretsFromEnv([bindingA], {
    "secret-a": "",
    SECRET_A: "from-fallback",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value[0]?.value, "from-fallback");
  }
});

test("resolveSecretsFromEnv() missing-vars error names BOTH accepted spellings per binding, keeping details.missing as the slug list", () => {
  const result = resolveSecretsFromEnv([bindingA, bindingB], {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /secret-a \(or SECRET_A\)/);
    assert.match(result.error.message, /secret-b \(or SECRET_B\)/);
    assert.deepEqual(result.error.details, {
      missing: ["secret-a", "secret-b"],
    });
  }
});
