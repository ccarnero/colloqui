import assert from "node:assert/strict";
import { test } from "node:test";
import { runPlanCommand } from "./plan-command.js";

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

test("runPlanCommand() happy path — puts the manifest then returns the plan", async () => {
  const putCalls: unknown[] = [];
  const planCalls: string[] = [];
  const client = {
    manifests: {
      put: async (name: string, manifest: Record<string, unknown>) => {
        putCalls.push({ name, manifest });
        return {
          id: "rev-1",
          tenantId: "t",
          name,
          revision: 1,
          manifest,
          createdAt: "now",
        };
      },
      plan: async (name: string) => {
        planCalls.push(name);
        return samplePlan;
      },
    },
  };

  const result = await runPlanCommand({
    client: client as never,
    manifest: { metadata: { name: "support-bot" } },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, samplePlan);
  }
  assert.equal(putCalls.length, 1);
  assert.deepEqual(planCalls, ["support-bot"]);
});

test("runPlanCommand() errors for a manifest missing metadata.name (invalid manifest) without calling the client", async () => {
  let called = false;
  const client = {
    manifests: {
      put: async () => {
        called = true;
        throw new Error("should not be called");
      },
      plan: async () => {
        called = true;
        throw new Error("should not be called");
      },
    },
  };

  const result = await runPlanCommand({
    client: client as never,
    manifest: {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /metadata/);
  }
  assert.equal(called, false);
});

test("runPlanCommand() wraps a thrown plan() error as a CliError", async () => {
  const client = {
    manifests: {
      put: async () => ({}),
      plan: async () => {
        throw new Error("conflict");
      },
    },
  };

  const result = await runPlanCommand({
    client: client as never,
    manifest: { metadata: { name: "support-bot" } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CLI");
  }
});
