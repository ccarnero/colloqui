import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSecretBindings } from "./extract-secret-bindings.js";

test("extractSecretBindings() returns an empty array when 'spec' is absent", () => {
  const result = extractSecretBindings({});
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, []);
  }
});

test("extractSecretBindings() returns an empty array when 'spec.secrets' is absent", () => {
  const result = extractSecretBindings({ spec: {} });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, []);
  }
});

test("extractSecretBindings() reads name + scope bindings", () => {
  const result = extractSecretBindings({
    spec: {
      secrets: [
        {
          name: "openai-api-key",
          scope: { kind: "connector", owner: "openai" },
        },
      ],
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [
      { name: "openai-api-key", scope: { kind: "connector", owner: "openai" } },
    ]);
  }
});

test("extractSecretBindings() errors on a malformed entry (missing scope)", () => {
  const result = extractSecretBindings({
    spec: { secrets: [{ name: "bad-entry" }] },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /spec\.secrets\[0\]\.scope/);
  }
});

test("extractSecretBindings() errors on scope.kind 'skill' (T01, manual-loops/provisioning-manifest-gaps-3.md — deliberately omitted, inert binding)", () => {
  const result = extractSecretBindings({
    spec: {
      secrets: [
        {
          name: "some-skill-secret",
          scope: { kind: "skill", owner: "refund-policy-expert" },
        },
      ],
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /scope\.kind/);
  }
});

test("extractSecretBindings() errors on an invalid scope.kind", () => {
  const result = extractSecretBindings({
    spec: {
      secrets: [
        { name: "bad-kind", scope: { kind: "not-a-kind", owner: "x" } },
      ],
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /scope\.kind/);
  }
});
