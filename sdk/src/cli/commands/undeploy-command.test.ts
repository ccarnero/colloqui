import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError, NotFoundError } from "../../domain/errors.js";
import {
  buildUndeployPreview,
  runUndeployCommand,
} from "./undeploy-command.js";

const manifest = {
  metadata: { name: "http-fanout-telegram" },
  spec: {
    channels: [{ name: "http-in" }],
    connectors: [{ name: "pokeapi", external: true }],
    workflows: [{ name: "fanout" }],
  },
};

const sampleReport = {
  manifestName: "http-fanout-telegram",
  resources: [{ kind: "workflow", name: "fanout", action: "deleted" }],
  secrets: [],
  deletedCount: 1,
  notFoundCount: 0,
  skippedCount: 0,
  checksumRowsDeleted: 0,
  manifestRecordDeleted: true,
  durationMs: 7,
};

function fakeClient(overrides: {
  undeploy?: (name: string) => Promise<unknown>;
  put?: () => Promise<unknown>;
  apply?: () => Promise<unknown>;
}) {
  return {
    manifests: {
      undeploy: overrides.undeploy ?? (async () => sampleReport),
      put:
        overrides.put ??
        (() => {
          throw new Error("undeploy must never store a manifest revision");
        }),
      apply:
        overrides.apply ??
        (() => {
          throw new Error("undeploy must never apply");
        }),
    },
  };
}

test("buildUndeployPreview() lists every declared resource with a delete/external verdict, from the file alone", () => {
  const preview = buildUndeployPreview(manifest);
  assert.equal(preview.ok, true);
  if (!preview.ok) {
    return;
  }
  assert.equal(preview.value.name, "http-fanout-telegram");
  assert.deepEqual(preview.value.rows, [
    { kind: "channel", name: "http-in", verdict: "delete" },
    { kind: "connector", name: "pokeapi", verdict: "external (kept)" },
    { kind: "workflow", name: "fanout", verdict: "delete" },
  ]);
});

test("buildUndeployPreview() errors for a manifest missing metadata.name", () => {
  const preview = buildUndeployPreview({ spec: { channels: [] } });
  assert.equal(preview.ok, false);
  if (!preview.ok) {
    assert.match(preview.error.message, /metadata/);
  }
});

test("buildUndeployPreview() surfaces a malformed section as a CLI error, never a crash", () => {
  const preview = buildUndeployPreview({
    metadata: { name: "broken" },
    spec: { agents: [{ noName: true }] },
  });
  assert.equal(preview.ok, false);
  if (!preview.ok) {
    assert.match(preview.error.message, /spec\.agents\[0\]\.name/);
  }
});

test("runUndeployCommand() calls client.manifests.undeploy() with the manifest's metadata.name and returns the report", async () => {
  const calls: string[] = [];
  const client = fakeClient({
    undeploy: async (name: string) => {
      calls.push(name);
      return sampleReport;
    },
  });

  const result = await runUndeployCommand({
    client: client as never,
    manifest,
  });

  assert.deepEqual(calls, ["http-fanout-telegram"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.kind, "undeployed");
    if (result.value.kind === "undeployed") {
      assert.deepEqual(result.value.report, sampleReport);
    }
  }
});

test("runUndeployCommand() maps a 404 to 'already_absent' (a second full undeploy is a SUCCESS, not a failure)", async () => {
  const client = fakeClient({
    undeploy: async () => {
      throw new NotFoundError("request failed: not found", {
        details: {
          httpStatus: 404,
          body: {
            message: "No manifest named 'http-fanout-telegram' found",
          },
        },
      });
    },
  });

  const result = await runUndeployCommand({
    client: client as never,
    manifest,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.kind, "already_absent");
    assert.equal(result.value.name, "http-fanout-telegram");
  }
});

test("runUndeployCommand() wraps any other transport failure in a CliError that keeps the SdkError as its cause (so the 409 body still renders)", async () => {
  const conflict = new ConflictError("request failed: conflict", {
    details: {
      httpStatus: 409,
      body: { error: { kind: "undeploy_blocked", dependents: [] } },
    },
  });
  const client = fakeClient({
    undeploy: async () => {
      throw conflict;
    },
  });

  const result = await runUndeployCommand({
    client: client as never,
    manifest,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /http-fanout-telegram/);
    assert.equal(result.error.cause, conflict);
  }
});

test("runUndeployCommand() errors for a manifest missing metadata.name without touching the client", async () => {
  let called = false;
  const client = fakeClient({
    undeploy: async () => {
      called = true;
      return sampleReport;
    },
  });

  const result = await runUndeployCommand({
    client: client as never,
    manifest: {},
  });

  assert.equal(result.ok, false);
  assert.equal(called, false);
});
