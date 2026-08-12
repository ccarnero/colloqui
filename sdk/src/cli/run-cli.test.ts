import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError, NotFoundError } from "../domain/errors.js";
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

const sampleUndeployReport = {
  manifestName: "support-bot",
  resources: [
    { kind: "workflow", name: "fanout", action: "deleted", externalId: "wf-1" },
    { kind: "connector", name: "pokeapi", action: "skipped_external" },
  ],
  secrets: [
    {
      name: "telegram-bot-token",
      scope: { kind: "channel", owner: "http-in" },
      action: "deleted",
    },
  ],
  deletedCount: 1,
  notFoundCount: 0,
  skippedCount: 1,
  checksumRowsDeleted: 0,
  manifestRecordDeleted: true,
  durationMs: 8,
};

const undeployableManifest = {
  metadata: { name: "support-bot" },
  spec: {
    channels: [{ name: "http-in" }],
    connectors: [{ name: "pokeapi", external: true }],
    workflows: [{ name: "fanout" }],
  },
};

function fakeClient(overrides: {
  validate?: () => Promise<unknown>;
  put?: () => Promise<unknown>;
  plan?: () => Promise<unknown>;
  apply?: () => Promise<unknown>;
  undeploy?: () => Promise<unknown>;
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
      undeploy: overrides.undeploy ?? (async () => sampleUndeployReport),
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

test("runCli() 'manifests apply' failure prints the server's structured apply_failed detail, not just the generic wrapper message (regression: apply used to swallow the server's error detail)", async () => {
  const stderr = collector();
  const client = fakeClient({
    apply: async () => {
      // True apply 409 body from the live repro: the WORKFLOW trips on the
      // unresolved connectorRef, with `substitute-symbolic-refs.ts`'s real
      // message format (NOT the plan-only `unresolvable_external_ref` text,
      // which apply's 409 never carries).
      throw new ConflictError("request failed: conflict", {
        details: {
          httpStatus: 409,
          body: {
            error: {
              kind: "apply_failed",
              manifestName: "http-fanout-telegram",
              applied: [
                {
                  kind: "channel",
                  name: "http-fanout-telegram",
                  verdict: "noop",
                },
                { kind: "connector", name: "pokeapi", verdict: "noop" },
                {
                  kind: "systemVariable",
                  name: "http-fanout-telegram-chat-id",
                  verdict: "noop",
                },
              ],
              pending: [],
              failure: {
                kind: "unresolved_symbolic_ref",
                resourceKind: "workflow",
                resourceName: "http-fanout-telegram",
                message:
                  "workflow 'http-fanout-telegram' at definition.actions[0].catfacts[0].args.adapterId references unresolved connectorRef 'catfacts' — no real id available for it (never created/resolved, or a dependency-order gap)",
              },
              durationMs: 3,
            },
          },
        },
      });
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "apply", "-f", "irrelevant.yaml"],
    client: client as never,
    readManifest: () => ({
      ok: true,
      value: { metadata: { name: "http-fanout-telegram" } },
    }),
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  const output = stderr.lines.join("\n");
  assert.match(output, /apply request failed for 'http-fanout-telegram'/);
  assert.match(output, /unresolved_symbolic_ref/);
  assert.match(output, /workflow\/http-fanout-telegram/);
  assert.match(output, /references unresolved connectorRef 'catfacts'/);
  assert.match(output, /applied=3 pending=0/);
  assert.match(output, /manifests plan -f <file>/);
});

test("runCli() 'manifests apply' failure prints a cycle_detected failure.kind body", async () => {
  const stderr = collector();
  const client = fakeClient({
    apply: async () => {
      throw new ConflictError("request failed: conflict", {
        details: {
          httpStatus: 409,
          body: {
            error: {
              kind: "cycle_detected",
              cycle: ["connector:a", "agent:b", "connector:a"],
              message: "dependency cycle detected",
            },
          },
        },
      });
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "apply", "-f", "irrelevant.yaml"],
    client: client as never,
    readManifest: () => ({
      ok: true,
      value: { metadata: { name: "cyclic-manifest" } },
    }),
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  const output = stderr.lines.join("\n");
  assert.match(output, /cycle detected: connector:a -> agent:b -> connector:a/);
});

test("runCli() 'manifests undeploy' WITHOUT --yes previews the deletion, exits 1, and NEVER calls the client", async () => {
  const stdout = collector();
  const stderr = collector();
  let undeployCalled = false;
  const client = fakeClient({
    undeploy: async () => {
      undeployCalled = true;
      return sampleUndeployReport;
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "undeploy", "-f", "irrelevant.yaml"],
    client: client as never,
    readManifest: () => ({ ok: true, value: undeployableManifest }),
    stdout: stdout.fn,
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  assert.equal(undeployCalled, false);
  const output = [...stdout.lines, ...stderr.lines].join("\n");
  // The manifest's own resources, with the delete/external verdict column.
  assert.match(output, /KIND\tNAME\tVERDICT/);
  assert.match(output, /channel\thttp-in\tdelete/);
  assert.match(output, /workflow\tfanout\tdelete/);
  assert.match(output, /connector\tpokeapi\texternal \(kept\)/);
  // ...and the instruction to confirm — no interactive prompt (non-TTY safe).
  assert.match(output, /--yes/);
  assert.doesNotMatch(output, /undefined/);
});

test("runCli() 'manifests undeploy --yes' calls the client and prints the outcome table plus the counts summary (no 'undefined' anywhere)", async () => {
  const stdout = collector();
  const stderr = collector();
  const calls: string[] = [];
  const client = fakeClient({
    undeploy: async (...args: unknown[]) => {
      calls.push(args[0] as string);
      return sampleUndeployReport;
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "undeploy", "-f", "irrelevant.yaml", "--yes"],
    client: client as never,
    readManifest: () => ({ ok: true, value: undeployableManifest }),
    stdout: stdout.fn,
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ["support-bot"]);
  const output = stdout.lines.join("\n");
  assert.match(output, /KIND\tNAME\tACTION/);
  assert.match(output, /workflow\tfanout\tdeleted/);
  assert.match(output, /connector\tpokeapi\tskipped_external/);
  assert.match(output, /telegram-bot-token \(channel:http-in\): deleted/);
  assert.match(
    output,
    /deleted=1 notFound=0 skipped=1 checksumRows=0 manifestRecordDeleted=true durationMs=8/
  );
  assert.doesNotMatch(
    [...stdout.lines, ...stderr.lines].join("\n"),
    /undefined/
  );
});

test("runCli() 'manifests undeploy --yes' renders a 404 as 'already undeployed' and exits 0 (second full undeploy, decision 6)", async () => {
  const stdout = collector();
  const stderr = collector();
  const client = fakeClient({
    undeploy: async () => {
      throw new NotFoundError("request failed: not found", {
        details: {
          httpStatus: 404,
          body: { message: "No manifest named 'support-bot' found" },
        },
      });
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "undeploy", "-f", "irrelevant.yaml", "--yes"],
    client: client as never,
    readManifest: () => ({ ok: true, value: undeployableManifest }),
    stdout: stdout.fn,
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 0);
  assert.match(
    stdout.lines.join("\n"),
    /already undeployed \(nothing stored under 'support-bot'\)/
  );
});

test("runCli() 'manifests undeploy --yes' renders the 409 undeploy_blocked dependents and exits 1", async () => {
  const stderr = collector();
  const client = fakeClient({
    undeploy: async () => {
      throw new ConflictError("request failed: conflict", {
        details: {
          httpStatus: 409,
          body: {
            error: {
              kind: "undeploy_blocked",
              manifestName: "support-bot",
              dependents: [
                {
                  manifestName: "http-fanout-telegram",
                  resourceKind: "channel",
                  resourceName: "http-in",
                },
              ],
              message:
                "manifest 'support-bot' cannot be undeployed: 1 resource(s) it owns are referenced as external by other stored manifests",
            },
          },
        },
      });
    },
  });

  const exitCode = await runCli({
    argv: ["manifests", "undeploy", "-f", "irrelevant.yaml", "--yes"],
    client: client as never,
    readManifest: () => ({ ok: true, value: undeployableManifest }),
    stdout: () => {},
    stderr: stderr.fn,
  });

  assert.equal(exitCode, 1);
  const output = stderr.lines.join("\n");
  assert.match(output, /undeploy request failed for 'support-bot'/);
  assert.match(output, /blocked by 1 dependent/);
  assert.match(output, /http-fanout-telegram -> channel\/http-in/);
  assert.doesNotMatch(output, /undefined/);
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

test("runCli() 'manifests --help' prints the group usage to stdout and exits 0 without touching the client", async () => {
  const stdout = collector();
  for (const helpArg of ["--help", "-h", "help"]) {
    stdout.lines.length = 0;
    const exitCode = await runCli({
      argv: ["manifests", helpArg],
      client: fakeClient({
        validate: async () => {
          throw new Error("client must not be called for --help");
        },
      }) as never,
      stdout: stdout.fn,
      stderr: () => {},
    });
    assert.equal(exitCode, 0, `exit code for '${helpArg}'`);
    const output = stdout.lines.join("\n");
    assert.match(output, /usage: yoizen manifests/);
    assert.match(output, /validate/);
    assert.match(output, /plan/);
    assert.match(output, /apply/);
    assert.match(output, /undeploy/);
    assert.match(output, /--secrets-from-env/);
    assert.match(output, /--yes/);
  }
});

test("runCli() 'manifests undeploy --help' prints the subcommand usage (mentioning --yes) and exits 0 without reading a manifest", async () => {
  const stdout = collector();
  const exitCode = await runCli({
    argv: ["manifests", "undeploy", "--help"],
    client: fakeClient({
      undeploy: async () => {
        throw new Error("client must not be called for --help");
      },
    }) as never,
    readManifest: (() => {
      throw new Error("readManifest must not be called for --help");
    }) as never,
    stdout: stdout.fn,
    stderr: () => {},
  });
  assert.equal(exitCode, 0);
  const output = stdout.lines.join("\n");
  assert.match(output, /usage: yoizen manifests undeploy/);
  assert.match(output, /--yes/);
});

test("runCli() 'manifests bogus' unknown-subcommand usage line lists undeploy", async () => {
  const stderr = collector();
  const exitCode = await runCli({
    argv: ["manifests", "bogus"],
    client: fakeClient({}) as never,
    stdout: () => {},
    stderr: stderr.fn,
  });
  assert.equal(exitCode, 1);
  const output = stderr.lines.join("\n");
  assert.match(output, /unknown subcommand 'bogus'/);
  assert.match(output, /undeploy/);
});

test("runCli() 'manifests apply --help' prints the subcommand usage and exits 0 without reading a manifest", async () => {
  const stdout = collector();
  const exitCode = await runCli({
    argv: ["manifests", "apply", "--help"],
    client: fakeClient({}) as never,
    readManifest: (() => {
      throw new Error("readManifest must not be called for --help");
    }) as never,
    stdout: stdout.fn,
    stderr: () => {},
  });
  assert.equal(exitCode, 0);
  const output = stdout.lines.join("\n");
  assert.match(output, /usage: yoizen manifests apply/);
  assert.match(output, /--secrets-from-env/);
});
