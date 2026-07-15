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
