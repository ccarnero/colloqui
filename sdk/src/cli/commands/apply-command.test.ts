import assert from "node:assert/strict";
import { test } from "node:test";
import { runApplyCommand } from "./apply-command.js";

const manifestWithSecret = {
  metadata: { name: "support-bot" },
  spec: {
    secrets: [
      { name: "openai-api-key", scope: { kind: "connector", owner: "openai" } },
    ],
  },
};

const sampleApplyResult = {
  manifestName: "support-bot",
  resources: [
    {
      kind: "channel",
      name: "http-in",
      verdict: "create",
      externalId: "ext-1",
    },
  ],
  appliedCount: 1,
  noopCount: 0,
  durationMs: 5,
};

function fakeClient(overrides: {
  secretsSet?: (
    name: string,
    value: string,
    scope: unknown
  ) => Promise<unknown>;
  manifestsPut?: () => Promise<unknown>;
  manifestsApply?: () => Promise<unknown>;
}) {
  return {
    manifests: {
      put: overrides.manifestsPut ?? (async () => ({})),
      apply: overrides.manifestsApply ?? (async () => sampleApplyResult),
    },
    secrets: {
      set:
        overrides.secretsSet ??
        (async () => ({ name: "x", scope: { kind: "channel", owner: "y" } })),
    },
  };
}

test("runApplyCommand() happy path without --secrets-from-env — put then apply, no secrets touched", async () => {
  let secretsSetCalled = false;
  const client = fakeClient({
    secretsSet: async () => {
      secretsSetCalled = true;
      return {} as never;
    },
  });

  const result = await runApplyCommand({
    client: client as never,
    manifest: { metadata: { name: "support-bot" } },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, sampleApplyResult);
  }
  assert.equal(secretsSetCalled, false);
});

test("runApplyCommand() --secrets-from-env happy path — resolves env, puts each secret, then puts+applies the manifest", async () => {
  const secretCalls: { name: string; value: string }[] = [];
  const client = fakeClient({
    secretsSet: async (name, value) => {
      secretCalls.push({ name, value });
      return { name, scope: { kind: "connector", owner: "openai" } };
    },
  });

  const result = await runApplyCommand({
    client: client as never,
    manifest: manifestWithSecret,
    secretsFromEnv: true,
    env: { "openai-api-key": "sk-test-value" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(secretCalls, [
    { name: "openai-api-key", value: "sk-test-value" },
  ]);
});

test("runApplyCommand() --secrets-from-env fails fast (lists ALL missing env vars) and never calls the client", async () => {
  let clientCalled = false;
  const client = fakeClient({
    secretsSet: async () => {
      clientCalled = true;
      return {} as never;
    },
    manifestsPut: async () => {
      clientCalled = true;
      return {};
    },
  });

  const result = await runApplyCommand({
    client: client as never,
    manifest: manifestWithSecret,
    secretsFromEnv: true,
    env: {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /openai-api-key/);
  }
  assert.equal(clientCalled, false);
});

test("runApplyCommand() errors for a manifest missing metadata.name (invalid manifest)", async () => {
  const client = fakeClient({});
  const result = await runApplyCommand({
    client: client as never,
    manifest: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /metadata/);
  }
});
