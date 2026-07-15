import assert from "node:assert/strict";
import { test } from "node:test";
import { runValidateCommand } from "./validate-command.js";

test("runValidateCommand() happy path — returns the validation result", async () => {
  const calls: unknown[] = [];
  const client = {
    manifests: {
      validate: async (manifest: Record<string, unknown>) => {
        calls.push(manifest);
        return { valid: true, errors: [] };
      },
    },
  };

  const result = await runValidateCommand({
    client: client as never,
    manifest: { kind: "IntegrationManifest" },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.valid, true);
  }
  assert.equal(calls.length, 1);
});

test("runValidateCommand() surfaces an invalid manifest as valid:false, not a Result error", async () => {
  const client = {
    manifests: {
      validate: async () => ({
        valid: false,
        errors: [{ path: "spec.channels", message: "required" }],
      }),
    },
  };

  const result = await runValidateCommand({
    client: client as never,
    manifest: { kind: "IntegrationManifest" },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.valid, false);
    assert.equal(result.value.errors.length, 1);
  }
});

test("runValidateCommand() wraps a thrown transport error as a CliError", async () => {
  const client = {
    manifests: {
      validate: async () => {
        throw new Error("network down");
      },
    },
  };

  const result = await runValidateCommand({
    client: client as never,
    manifest: {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CLI");
    assert.match(result.error.message, /request failed/);
  }
});
