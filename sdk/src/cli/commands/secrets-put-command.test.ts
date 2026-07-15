import assert from "node:assert/strict";
import { test } from "node:test";
import { runSecretsPutCommand } from "./secrets-put-command.js";

test("runSecretsPutCommand() happy path — puts the secret and returns the write-only echo", async () => {
  const calls: { name: string; value: string; scope: unknown }[] = [];
  const client = {
    secrets: {
      set: async (name: string, value: string, scope: unknown) => {
        calls.push({ name, value, scope });
        return { name, scope };
      },
    },
  };

  const result = await runSecretsPutCommand({
    client: client as never,
    name: "openai-api-key",
    scope: { kind: "connector", owner: "openai" },
    value: "sk-test-value",
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.value, "sk-test-value");
  // The write-only echo never carries the value back.
  if (result.ok) {
    assert.deepEqual(result.value, {
      name: "openai-api-key",
      scope: { kind: "connector", owner: "openai" },
    });
  }
});

test("runSecretsPutCommand() wraps a thrown transport error as a CliError", async () => {
  const client = {
    secrets: {
      set: async () => {
        throw new Error("forbidden");
      },
    },
  };

  const result = await runSecretsPutCommand({
    client: client as never,
    name: "openai-api-key",
    scope: { kind: "connector", owner: "openai" },
    value: "sk-test-value",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CLI");
  }
});
