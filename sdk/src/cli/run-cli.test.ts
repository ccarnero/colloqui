import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError } from "./cli-error.js";
import { runCli } from "./run-cli.js";

function collector() {
  const lines: string[] = [];
  return { fn: (line: string) => lines.push(line), lines };
}

const samplePlan = {
  manifestName: "support-bot",
  resources: [
    {
      kind: "channel",
      name: "http-in",
      external: false,
      verdict: "create",
      diff: [],
    },
  ],
  preconditions: [],
};

function fakeClient(overrides: {
  validate?: () => Promise<unknown>;
  put?: () => Promise<unknown>;
  plan?: () => Promise<unknown>;
  apply?: () => Promise<unknown>;
  secretsSet?: () => Promise<unknown>;
}) {
  return {
    manifests: {
      validate:
        overrides.validate ?? (async () => ({ valid: true, errors: [] })),
      put: overrides.put ?? (async () => ({})),
      plan: overrides.plan ?? (async () => samplePlan),
      apply:
        overrides.apply ??
        (async () => ({
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

test("runCli() 'manifests plan -f <file>' happy path prints a greppable verdict table", async () => {
  const stdout = collector();
  const stderr = collector();
  const client = fakeClient({});

  const exitCode = await runCli({
    argv: ["manifests", "plan", "-f", "irrelevant.yaml"],
    client: client as never,
    readManifest: () => ({
      ok: true,
      value: { metadata: { name: "support-bot" } },
    }),
    stdout: stdout.fn,
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 0);
  const output = stdout.lines.join("\n");
  assert.match(output, /create/);
  assert.match(output, /http-in/);
});

test("runCli() 'manifests validate -f <file>' reports INVALID for a structurally invalid manifest", async () => {
  const stdout = collector();
  const client = fakeClient({
    validate: async () => ({
      valid: false,
      errors: [
        {
          path: "spec.channels",
          message: "at least one inbound channel is required",
        },
      ],
    }),
  });

  const exitCode = await runCli({
    argv: ["manifests", "validate", "-f", "irrelevant.yaml"],
    client: client as never,
    readManifest: () => ({ ok: true, value: {} }),
    stdout: stdout.fn,
    stderr: () => {},
  });

  assert.equal(exitCode, 1);
  assert.match(stdout.lines.join("\n"), /INVALID/);
});

test("runCli() 'manifests validate' surfaces an unreadable/invalid manifest file as a CLI error, never a crash", async () => {
  const stderr = collector();
  const client = fakeClient({});

  const exitCode = await runCli({
    argv: ["manifests", "validate", "-f", "does-not-exist.yaml"],
    client: client as never,
    readManifest: () => ({
      ok: false,
      error: new CliError("could not read manifest file 'does-not-exist.yaml'"),
    }),
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.lines.join("\n"), /could not read manifest file/);
});

test("runCli() 'manifests validate' without -f/--file fails with a clear usage error", async () => {
  const stderr = collector();
  const client = fakeClient({});

  const exitCode = await runCli({
    argv: ["manifests", "validate"],
    client: client as never,
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.lines.join("\n"), /-f\/--file/);
});

test("runCli() 'manifests apply --secrets-from-env' fails fast when a bound env var is missing", async () => {
  const stderr = collector();
  const client = fakeClient({});

  const exitCode = await runCli({
    argv: ["manifests", "apply", "-f", "irrelevant.yaml", "--secrets-from-env"],
    client: client as never,
    env: {},
    readManifest: () => ({
      ok: true,
      value: {
        metadata: { name: "support-bot" },
        spec: {
          secrets: [
            {
              name: "openai-api-key",
              scope: { kind: "connector", owner: "openai" },
            },
          ],
        },
      },
    }),
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.lines.join("\n"), /openai-api-key/);
});

test("runCli() 'manifests apply --secrets-from-env' happy path binds the secret from env then applies", async () => {
  const stdout = collector();
  const secretCalls: unknown[] = [];
  const client = fakeClient({
    secretsSet: async (...args: unknown[]) => {
      secretCalls.push(args);
      return {};
    },
    apply: async () => ({
      resources: [
        {
          kind: "connector",
          name: "openai",
          verdict: "create",
          externalId: "x",
        },
      ],
      appliedCount: 1,
      noopCount: 0,
      durationMs: 2,
    }),
  });

  const exitCode = await runCli({
    argv: ["manifests", "apply", "-f", "irrelevant.yaml", "--secrets-from-env"],
    client: client as never,
    env: { "openai-api-key": "sk-test" },
    readManifest: () => ({
      ok: true,
      value: {
        metadata: { name: "support-bot" },
        spec: {
          secrets: [
            {
              name: "openai-api-key",
              scope: { kind: "connector", owner: "openai" },
            },
          ],
        },
      },
    }),
    stdout: stdout.fn,
    stderr: () => {},
  });

  assert.equal(exitCode, 0);
  assert.equal(secretCalls.length, 1);
  assert.match(stdout.lines.join("\n"), /create/);
});

test("runCli() 'secrets put' missing --value-env env var fails fast without calling the client", async () => {
  const stderr = collector();
  let called = false;
  const client = fakeClient({
    secretsSet: async () => {
      called = true;
      return {};
    },
  });

  const exitCode = await runCli({
    argv: [
      "secrets",
      "put",
      "openai-api-key",
      "--scope",
      "connector:openai",
      "--value-env",
      "OPENAI_API_KEY",
    ],
    client: client as never,
    env: {},
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  assert.equal(called, false);
  assert.match(stderr.lines.join("\n"), /OPENAI_API_KEY/);
});

test("runCli() 'secrets put' happy path resolves the value from env and never prints it", async () => {
  const stdout = collector();
  const stderr = collector();
  const calls: { value: string }[] = [];
  const client = fakeClient({
    secretsSet: async (...args: unknown[]) => {
      calls.push({ value: args[1] as string });
      return { name: args[0], scope: args[2] };
    },
  });

  const exitCode = await runCli({
    argv: [
      "secrets",
      "put",
      "openai-api-key",
      "--scope",
      "connector:openai",
      "--value-env",
      "OPENAI_API_KEY",
    ],
    client: client as never,
    env: { OPENAI_API_KEY: "sk-super-secret" },
    stdout: stdout.fn,
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0]!.value, "sk-super-secret");
  const allOutput = [...stdout.lines, ...stderr.lines].join("\n");
  assert.doesNotMatch(allOutput, /sk-super-secret/);
});

test("runCli() reports a clear error for an unknown command", async () => {
  const stderr = collector();
  const exitCode = await runCli({
    argv: ["bogus"],
    client: fakeClient({}) as never,
    stdout: () => {},
    stderr: stderr.fn,
  });
  assert.equal(exitCode, 1);
  assert.match(stderr.lines.join("\n"), /unknown command/);
});
