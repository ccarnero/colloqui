import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractSecretBindings } from "./extract-secret-bindings.js";
import { readManifestFile } from "./read-manifest-file.js";
import { resolveSecretsFromEnv } from "./resolve-secrets-from-env.js";
import { runCli } from "./run-cli.js";

/**
 * manual-loops/provisioning-manifest-gaps.md T07 — end-to-end CLI
 * compatibility sweep. Proves `manifests validate|plan|apply` and `secrets
 * put` operate generically over EVERY new manifest-v1 section (T01-T06)
 * WITHOUT any new CLI subcommand, by driving the real `readManifestFile`
 * (Bun.YAML) against the comprehensive fixture and a fake HTTP layer (same
 * mocking style as `run-cli.test.ts`).
 */

const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../test/cli/fixtures/comprehensive-manifest.yaml",
    import.meta.url
  )
);

function collector() {
  const lines: string[] = [];
  return { fn: (line: string) => lines.push(line), lines };
}

function fakeClient(overrides: {
  validate?: () => Promise<unknown>;
  put?: () => Promise<unknown>;
  plan?: () => Promise<unknown>;
  apply?: () => Promise<unknown>;
  secretsSet?: (...args: unknown[]) => Promise<unknown>;
}) {
  return {
    manifests: {
      validate:
        overrides.validate ?? (async () => ({ valid: true, errors: [] })),
      put: overrides.put ?? (async () => ({})),
      plan:
        overrides.plan ??
        (async () => ({
          manifestName: "cli-comprehensive-sample",
          resources: [],
          preconditions: [],
        })),
      apply:
        overrides.apply ??
        (async () => ({
          manifestName: "cli-comprehensive-sample",
          resources: [],
          appliedCount: 0,
          noopCount: 0,
          durationMs: 1,
        })),
    },
    secrets: {
      set: overrides.secretsSet ?? (async () => ({})),
    },
  };
}

test("readManifestFile() parses the comprehensive fixture (real Bun.YAML, every new section present)", () => {
  const result = readManifestFile(FIXTURE_PATH);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const spec = result.value.spec as Record<string, unknown>;
  assert.equal((spec.connectors as unknown[]).length, 1);
  assert.equal((spec.mcpServers as unknown[]).length, 1);
  assert.equal((spec.services as unknown[]).length, 1);
  assert.equal((spec.systemVariables as unknown[]).length, 1);
  assert.equal((spec.agents as unknown[]).length, 1);
  assert.equal((spec.workflows as unknown[]).length, 1);
  assert.equal((spec.secrets as unknown[]).length, 3);
});

test("extractSecretBindings() finds every top-level spec.secrets[] binding, including a mcpServer-scoped one", () => {
  const manifestResult = readManifestFile(FIXTURE_PATH);
  assert.equal(manifestResult.ok, true);
  if (!manifestResult.ok) {
    return;
  }

  const bindingsResult = extractSecretBindings(manifestResult.value);
  assert.equal(bindingsResult.ok, true);
  if (!bindingsResult.ok) {
    return;
  }

  assert.deepEqual(
    bindingsResult.value.map((binding) => binding.name).sort(),
    [
      "connector-bearer-token",
      "mcp-server-bearer-token",
      "mcp-server-header-key",
    ].sort()
  );

  const mcpBindings = bindingsResult.value.filter(
    (binding) => binding.scope.kind === "mcpServer"
  );
  assert.equal(mcpBindings.length, 2);
  for (const binding of mcpBindings) {
    assert.equal(binding.scope.owner, "cli-comprehensive-mcp-server");
  }

  const connectorBinding = bindingsResult.value.find(
    (binding) => binding.scope.kind === "connector"
  );
  assert.ok(connectorBinding);
  assert.equal(connectorBinding?.scope.owner, "cli-comprehensive-connector");
});

test("extractSecretBindings() does NOT need any change for nested secretRefs — they only NAME a top-level binding, never carry a value", () => {
  // The nested `auth.bearerToken.secretRef` / `headers.*.secretRef` values in
  // the fixture are plain name strings ("connector-bearer-token", etc.) that
  // match `spec.secrets[].name` entries above. extractSecretBindings() never
  // walks into `connectors`/`mcpServers` at all — it only reads
  // `spec.secrets[]` — confirming the SPEC's open question: no extractor
  // change is required for the nested positions themselves, only for the
  // scope KIND list (`VALID_SCOPE_KINDS`) so a `mcpServer`-scoped top-level
  // binding is accepted.
  const manifestResult = readManifestFile(FIXTURE_PATH);
  assert.equal(manifestResult.ok, true);
  if (!manifestResult.ok) {
    return;
  }
  const connectors = (manifestResult.value.spec as Record<string, unknown>)
    .connectors as Record<string, unknown>[];
  const auth = connectors[0]?.auth as Record<string, unknown>;
  const bearerToken = auth.bearerToken as Record<string, unknown>;
  assert.equal(bearerToken.secretRef, "connector-bearer-token");
});

test("--secrets-from-env resolves EVERY binding a comprehensive manifest declares (connector + both mcpServer bindings)", () => {
  const manifestResult = readManifestFile(FIXTURE_PATH);
  assert.equal(manifestResult.ok, true);
  if (!manifestResult.ok) {
    return;
  }

  const bindingsResult = extractSecretBindings(manifestResult.value);
  assert.equal(bindingsResult.ok, true);
  if (!bindingsResult.ok) {
    return;
  }

  const env = {
    "connector-bearer-token": "sk-connector-value",
    "mcp-server-bearer-token": "sk-mcp-bearer-value",
    "mcp-server-header-key": "sk-mcp-header-value",
  };
  const resolvedResult = resolveSecretsFromEnv(bindingsResult.value, env);
  assert.equal(resolvedResult.ok, true);
  if (!resolvedResult.ok) {
    return;
  }
  assert.equal(resolvedResult.value.length, 3);
  for (const binding of resolvedResult.value) {
    assert.equal(binding.value, env[binding.name as keyof typeof env]);
  }
});

test("runCli() 'manifests validate' accepts the comprehensive manifest shape without a new subcommand", async () => {
  const stdout = collector();
  const client = fakeClient({});

  const exitCode = await runCli({
    argv: ["manifests", "validate", "-f", FIXTURE_PATH],
    client: client as never,
    stdout: stdout.fn,
    stderr: () => {},
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.lines.join("\n"), /VALID/);
});

test("runCli() 'manifests plan' prints a verdict table with the new resource kinds (mcpServer, systemVariable)", async () => {
  const stdout = collector();
  const client = fakeClient({
    plan: async () => ({
      manifestName: "cli-comprehensive-sample",
      resources: [
        {
          kind: "connector",
          name: "cli-comprehensive-connector",
          external: false,
          verdict: "create",
          diff: [],
        },
        {
          kind: "mcpServer",
          name: "cli-comprehensive-mcp-server",
          external: false,
          verdict: "create",
          diff: [],
        },
        {
          kind: "systemVariable",
          name: "cli-comprehensive-flag",
          external: false,
          verdict: "create",
          diff: [],
        },
        {
          kind: "service",
          name: "cli-comprehensive-service",
          external: false,
          verdict: "create",
          diff: [],
        },
      ],
      preconditions: [],
    }),
  });

  const exitCode = await runCli({
    argv: ["manifests", "plan", "-f", FIXTURE_PATH],
    client: client as never,
    stdout: stdout.fn,
    stderr: () => {},
  });

  assert.equal(exitCode, 0);
  const output = stdout.lines.join("\n");
  assert.match(output, /mcpServer/);
  assert.match(output, /systemVariable/);
  assert.match(output, /create/);
});

test("runCli() 'manifests apply --secrets-from-env' binds every comprehensive-fixture secret then applies, never logging a value", async () => {
  const stdout = collector();
  const stderr = collector();
  const secretCalls: { name: string; value: string; scope: unknown }[] = [];

  const client = fakeClient({
    secretsSet: async (...args: unknown[]) => {
      secretCalls.push({
        name: args[0] as string,
        value: args[1] as string,
        scope: args[2],
      });
      return { name: args[0], scope: args[2] };
    },
    apply: async () => ({
      manifestName: "cli-comprehensive-sample",
      resources: [
        {
          kind: "connector",
          name: "cli-comprehensive-connector",
          verdict: "create",
          externalId: "conn-1",
        },
        {
          kind: "mcpServer",
          name: "cli-comprehensive-mcp-server",
          verdict: "create",
          externalId: "mcp-1",
        },
      ],
      appliedCount: 2,
      noopCount: 0,
      durationMs: 3,
    }),
  });

  const exitCode = await runCli({
    argv: ["manifests", "apply", "-f", FIXTURE_PATH, "--secrets-from-env"],
    client: client as never,
    env: {
      "connector-bearer-token": "sk-connector-value",
      "mcp-server-bearer-token": "sk-mcp-bearer-value",
      "mcp-server-header-key": "sk-mcp-header-value",
    },
    stdout: stdout.fn,
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 0);
  assert.equal(secretCalls.length, 3);
  assert.deepEqual(
    secretCalls.map((call) => call.name).sort(),
    [
      "connector-bearer-token",
      "mcp-server-bearer-token",
      "mcp-server-header-key",
    ].sort()
  );

  const allOutput = [...stdout.lines, ...stderr.lines].join("\n");
  assert.doesNotMatch(allOutput, /sk-connector-value/);
  assert.doesNotMatch(allOutput, /sk-mcp-bearer-value/);
  assert.doesNotMatch(allOutput, /sk-mcp-header-value/);
  assert.match(stdout.lines.join("\n"), /mcpServer/);
});

test("runCli() 'manifests apply --secrets-from-env' fails fast when the mcpServer-scoped bindings' env vars are missing", async () => {
  const stderr = collector();
  let clientCalled = false;
  const client = fakeClient({
    secretsSet: async () => {
      clientCalled = true;
      return {};
    },
    put: async () => {
      clientCalled = true;
      return {};
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "apply", "-f", FIXTURE_PATH, "--secrets-from-env"],
    client: client as never,
    env: {},
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  assert.equal(clientCalled, false);
  const errorOutput = stderr.lines.join("\n");
  assert.match(errorOutput, /connector-bearer-token/);
  assert.match(errorOutput, /mcp-server-bearer-token/);
  assert.match(errorOutput, /mcp-server-header-key/);
});
