import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest, SecretScope } from "@yoizen/shared";
import type {
  IPlatformResourceDeleter,
  PlatformResourceDeleters,
} from "../../../src/modules/undeploy/domain/platform-resource-deleter.interface";
import { buildUndeployOrder } from "../../../src/modules/undeploy/lib/build-undeploy-order";
import { undeployManifest } from "../../../src/modules/undeploy/lib/undeploy-manifest";

/**
 * Manifest under test: one channel, one connector, one agent, one workflow
 * that references all three, plus a knowledge base and two secret bindings.
 * Apply order is channel -> connector -> KB -> agent -> workflow, so the
 * undeploy order must be exactly the inverse.
 */
function demoManifest(): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "demo" },
    spec: {
      channels: [{ name: "tg-in", type: "telegram", direction: "inbound" }],
      connectors: [{ name: "hubspot", type: "http" }],
      agents: [{ name: "support-agent", profile: {} }],
      knowledgeBases: [
        {
          name: "support-kb",
          documents: [
            { name: "faq", source: { type: "inline", content: "x" } },
          ],
        },
      ],
      services: [],
      systemVariables: [],
      mcpServers: [],
      skills: [],
      workflows: [
        {
          name: "router",
          definition: {
            steps: [{ channelRef: "tg-in" }, { agentRef: "support-agent" }],
          },
        },
      ],
      secrets: [
        { name: "tg-token", scope: { kind: "channel", owner: "tg-in" } },
        { name: "hs-key", scope: { kind: "connector", owner: "hubspot" } },
      ],
    },
  };
}

interface Recorder {
  readonly calls: string[];
}

/**
 * In-memory deleter set backed by a `"<kind>:<name>" -> externalId` map of
 * what is "live". Every lookup and delete is appended to `calls`, so a test
 * can assert BOTH the order and the exact set of downstream calls.
 */
function fakeDeleters(
  live: Map<string, string>,
  recorder: Recorder,
  kinds: readonly string[] = [
    "channel",
    "connector",
    "agent",
    "workflow",
    "knowledgeBase",
    "service",
    "mcpServer",
    "skill",
    "systemVariable",
  ]
): PlatformResourceDeleters {
  const deleters: Record<string, IPlatformResourceDeleter> = {};
  for (const kind of kinds) {
    deleters[kind] = {
      async findOwnedId(_tenantId, resourceName) {
        recorder.calls.push(`find:${kind}:${resourceName}`);
        return { ok: true, value: live.get(`${kind}:${resourceName}`) ?? null };
      },
      async deleteById(_tenantId, externalId, resourceName) {
        recorder.calls.push(`delete:${kind}:${resourceName}`);
        const key = `${kind}:${resourceName}`;
        const existed = live.get(key) === externalId;
        live.delete(key);
        return { ok: true, value: { deleted: existed } };
      },
    };
  }
  return deleters;
}

function liveEverything(): Map<string, string> {
  return new Map([
    ["channel:tg-in", "ext-channel"],
    ["connector:hubspot", "ext-connector"],
    ["agent:support-agent", "ext-agent"],
    ["workflow:router", "ext-workflow"],
    ["knowledgeBase:support-kb", "ext-kb"],
  ]);
}

function fakeDeleteSecret(recorder: Recorder, present = new Set<string>()) {
  return async (_tenantId: string, name: string, scope: SecretScope) => {
    recorder.calls.push(`secret:${scope.kind}/${scope.owner}/${name}`);
    return {
      ok: true as const,
      value: { deleted: present.has(name) },
    };
  };
}

async function run(
  manifest: IntegrationManifest,
  deleters: PlatformResourceDeleters,
  recorder: Recorder,
  secretsPresent = new Set<string>(["tg-token", "hs-key"])
) {
  const order = buildUndeployOrder(manifest);
  if (!order.ok) {
    throw new Error("expected a valid undeploy order for this fixture");
  }
  return undeployManifest({
    manifest,
    tenantId: "acme",
    targets: order.value,
    deleters,
    deleteSecret: fakeDeleteSecret(recorder, secretsPresent),
  });
}

describe("undeployManifest", () => {
  it("deletes resources in REVERSE dependency order", async () => {
    const recorder: Recorder = { calls: [] };
    const manifest = demoManifest();
    const result = await run(
      manifest,
      fakeDeleters(liveEverything(), recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.resources.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "workflow:router",
      "agent:support-agent",
      "knowledgeBase:support-kb",
      "connector:hubspot",
      "channel:tg-in",
    ]);
    expect(recorder.calls.filter((c) => c.startsWith("delete:"))).toEqual([
      "delete:workflow:router",
      "delete:agent:support-agent",
      "delete:knowledgeBase:support-kb",
      "delete:connector:hubspot",
      "delete:channel:tg-in",
    ]);
    expect(result.value.deletedCount).toBe(5);
    expect(result.value.notFoundCount).toBe(0);
  });

  it("deletes each secret binding AFTER its owner resource", async () => {
    const recorder: Recorder = { calls: [] };
    const result = await run(
      demoManifest(),
      fakeDeleters(liveEverything(), recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    const ordered = recorder.calls.filter(
      (c) => c.startsWith("delete:") || c.startsWith("secret:")
    );
    expect(ordered).toEqual([
      "delete:workflow:router",
      "delete:agent:support-agent",
      "delete:knowledgeBase:support-kb",
      "delete:connector:hubspot",
      "secret:connector/hubspot/hs-key",
      "delete:channel:tg-in",
      "secret:channel/tg-in/tg-token",
    ]);
    if (!result.ok) {
      return;
    }
    expect(result.value.secrets).toEqual([
      {
        name: "hs-key",
        scope: { kind: "connector", owner: "hubspot" },
        action: "deleted",
      },
      {
        name: "tg-token",
        scope: { kind: "channel", owner: "tg-in" },
        action: "deleted",
      },
    ]);
  });

  it("reports an absent secret as not_found instead of failing", async () => {
    const recorder: Recorder = { calls: [] };
    const result = await run(
      demoManifest(),
      fakeDeleters(liveEverything(), recorder),
      recorder,
      new Set<string>()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.secrets.map((s) => s.action)).toEqual([
      "not_found",
      "not_found",
    ]);
  });

  it("never deletes a secret binding the manifest marks external", async () => {
    const recorder: Recorder = { calls: [] };
    const manifest = demoManifest();
    manifest.spec.secrets[1] = {
      name: "hs-key",
      scope: { kind: "connector", owner: "hubspot" },
      external: true,
    };

    const result = await run(
      manifest,
      fakeDeleters(liveEverything(), recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.secrets.find((s) => s.name === "hs-key")?.action).toBe(
      "skipped_external"
    );
    expect(recorder.calls).not.toContain("secret:connector/hubspot/hs-key");
  });

  it("never deletes a resource the manifest marks external", async () => {
    const recorder: Recorder = { calls: [] };
    const manifest = demoManifest();
    manifest.spec.connectors[0]!.external = true;

    const result = await run(
      manifest,
      fakeDeleters(liveEverything(), recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.resources.find((r) => r.name === "hubspot")?.action
    ).toBe("skipped_external");
    expect(recorder.calls).not.toContain("find:connector:hubspot");
    expect(recorder.calls).not.toContain("delete:connector:hubspot");
    expect(result.value.skippedCount).toBe(1);
  });

  it("KEEPS the secret of an external resource — the owner stays live", async () => {
    const recorder: Recorder = { calls: [] };
    const manifest = demoManifest();
    manifest.spec.connectors[0]!.external = true;

    const result = await run(
      manifest,
      fakeDeleters(liveEverything(), recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.secrets.find((s) => s.name === "hs-key")).toEqual({
      name: "hs-key",
      scope: { kind: "connector", owner: "hubspot" },
      action: "skipped_external",
    });
    expect(recorder.calls).not.toContain("secret:connector/hubspot/hs-key");
  });

  it("KEEPS the secret of a resource skipped for having no delete route", async () => {
    const recorder: Recorder = { calls: [] };
    const deleters = fakeDeleters(liveEverything(), recorder, [
      "channel",
      "agent",
      "workflow",
      "knowledgeBase",
    ]);

    const result = await run(demoManifest(), deleters, recorder);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.secrets.find((s) => s.name === "hs-key")?.action).toBe(
      "skipped_no_delete_api"
    );
    expect(recorder.calls).not.toContain("secret:connector/hubspot/hs-key");
  });

  it("reports skipped_no_delete_api for a kind with no wired deleter", async () => {
    const recorder: Recorder = { calls: [] };
    const deleters = fakeDeleters(liveEverything(), recorder, [
      "channel",
      "connector",
      "agent",
      "knowledgeBase",
    ]);

    const result = await run(demoManifest(), deleters, recorder);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.resources.find((r) => r.kind === "workflow")?.action
    ).toBe("skipped_no_delete_api");
    expect(recorder.calls).not.toContain("delete:workflow:router");
  });

  it("tolerates resources that are already gone (not_found, still ok)", async () => {
    const recorder: Recorder = { calls: [] };
    const live = liveEverything();
    live.delete("workflow:router");
    live.delete("knowledgeBase:support-kb");

    const result = await run(
      demoManifest(),
      fakeDeleters(live, recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.resources.find((r) => r.name === "router")?.action
    ).toBe("not_found");
    expect(result.value.notFoundCount).toBe(2);
    expect(result.value.deletedCount).toBe(3);
  });

  it("treats a downstream 'no such id' on DELETE as not_found, not a failure", async () => {
    const recorder: Recorder = { calls: [] };
    const deleters = fakeDeleters(liveEverything(), recorder);
    const workflowDeleter = deleters.workflow;
    if (!workflowDeleter) {
      throw new Error("fixture must wire a workflow deleter");
    }
    // Simulates agent-admin's `200 false` / a 404 race: the lookup found an
    // id but the resource vanished before the DELETE landed.
    workflowDeleter.deleteById = async () => ({
      ok: true,
      value: { deleted: false },
    });

    const result = await run(demoManifest(), deleters, recorder);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.resources.find((r) => r.name === "router")?.action
    ).toBe("not_found");
  });

  it("is idempotent: a second run reports every resource not_found with the same shape", async () => {
    const live = liveEverything();
    const firstRecorder: Recorder = { calls: [] };
    const first = await run(
      demoManifest(),
      fakeDeleters(live, firstRecorder),
      firstRecorder
    );

    const secondRecorder: Recorder = { calls: [] };
    const second = await run(
      demoManifest(),
      fakeDeleters(live, secondRecorder),
      secondRecorder,
      new Set<string>()
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value.resources.map((r) => `${r.kind}:${r.name}`)).toEqual(
      first.value.resources.map((r) => `${r.kind}:${r.name}`)
    );
    expect(second.value.resources.every((r) => r.action === "not_found")).toBe(
      true
    );
    expect(second.value.deletedCount).toBe(0);
    expect(second.value.notFoundCount).toBe(5);
    expect(secondRecorder.calls.filter((c) => c.startsWith("delete:"))).toEqual(
      []
    );
    expect(second.value.secrets.every((s) => s.action === "not_found")).toBe(
      true
    );
  });

  it("stops at the first failure and reports what remains pending", async () => {
    const recorder: Recorder = { calls: [] };
    const deleters = fakeDeleters(liveEverything(), recorder);
    const agentDeleter = deleters.agent;
    if (!agentDeleter) {
      throw new Error("fixture must wire an agent deleter");
    }
    agentDeleter.deleteById = async () => ({
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: "support-agent",
        message: "HTTP 500 from agent-admin",
      },
    });

    const result = await run(demoManifest(), deleters, recorder);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("undeploy_failed");
    expect(result.error.failure.message).toContain("HTTP 500");
    expect(result.error.resources.map((r) => r.name)).toEqual(["router"]);
    expect(result.error.pending.map((p) => `${p.kind}:${p.name}`)).toEqual([
      "agent:support-agent",
      "knowledgeBase:support-kb",
      "connector:hubspot",
      "channel:tg-in",
    ]);
    expect(result.error.manifestRecordDeleted).toBe(false);
    // The channel's secret is never touched — its owner was never reached.
    expect(recorder.calls).not.toContain("secret:channel/tg-in/tg-token");
  });

  it("stops when a lookup fails — never guesses an id to delete", async () => {
    const recorder: Recorder = { calls: [] };
    const deleters = fakeDeleters(liveEverything(), recorder);
    const workflowDeleter = deleters.workflow;
    if (!workflowDeleter) {
      throw new Error("fixture must wire a workflow deleter");
    }
    workflowDeleter.findOwnedId = async () => ({
      ok: false,
      error: {
        kind: "lookup_failed",
        resourceKind: "workflow",
        resourceName: "router",
        message: "workflow-service unreachable",
      },
    });

    const result = await run(demoManifest(), deleters, recorder);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.failure.kind).toBe("lookup_failed");
    expect(recorder.calls.filter((c) => c.startsWith("delete:"))).toEqual([]);
  });

  it("still deletes a secret bound to a resource that is no longer live", async () => {
    const recorder: Recorder = { calls: [] };
    const live = liveEverything();
    live.delete("channel:tg-in");

    const result = await run(
      demoManifest(),
      fakeDeleters(live, recorder),
      recorder
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.value.secrets.find((s) => s.name === "tg-token")?.action
    ).toBe("deleted");
  });

  it("processes a binding whose owner is not a declared resource at the end", async () => {
    const recorder: Recorder = { calls: [] };
    const manifest = demoManifest();
    manifest.spec.secrets.push({
      name: "orphan-key",
      scope: { kind: "service", owner: "gone" },
    });

    const result = await run(
      manifest,
      fakeDeleters(liveEverything(), recorder),
      recorder,
      new Set(["orphan-key"])
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.secrets.at(-1)).toEqual({
      name: "orphan-key",
      scope: { kind: "service", owner: "gone" },
      action: "deleted",
    });
    expect(recorder.calls.at(-1)).toBe("secret:service/gone/orphan-key");
  });

  it("fails the run when a secret delete fails (the credential must not survive silently)", async () => {
    const recorder: Recorder = { calls: [] };
    const order = buildUndeployOrder(demoManifest());
    if (!order.ok) {
      throw new Error("expected a valid undeploy order for this fixture");
    }

    const result = await undeployManifest({
      manifest: demoManifest(),
      tenantId: "acme",
      targets: order.value,
      deleters: fakeDeleters(liveEverything(), recorder),
      deleteSecret: async () => ({ ok: false, error: "k8s API unreachable" }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.failure.resourceKind).toBe("secret");
    expect(result.error.failure.message).toContain("k8s API unreachable");
  });
});
