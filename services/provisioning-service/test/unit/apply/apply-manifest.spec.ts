import "../../setup-env";
import { describe, expect, it, mock } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import type { IApplyEventPublisher } from "../../../src/modules/apply/domain/apply-event-publisher.interface";
import type { PlatformResourceWriters } from "../../../src/modules/apply/domain/platform-resource-writer.interface";
import { applyManifestPlan } from "../../../src/modules/apply/lib/apply-manifest";
import type { ManifestPlan } from "../../../src/modules/plan/domain/plan.interfaces";

function manifestWith(names: {
  channel?: string;
  workflow?: string;
  agent?: string;
}): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "e2e-manifest-apply" },
    spec: {
      channels: names.channel
        ? [{ name: names.channel, type: "http", direction: "inbound" }]
        : [],
      connectors: [],
      agents: names.agent ? [{ name: names.agent, profile: {} }] : [],
      knowledgeBases: [],
      services: [],
      workflows: names.workflow
        ? [
            {
              name: names.workflow,
              definition: { application: "e2e", actions: [] },
            },
          ]
        : [],
      secrets: [],
    },
  };
}

// Synthetic run-root causal context the fake publisher returns from
// applyStarted, so the engine has something to thread into every sibling.
const FAKE_RUN_ID = "run-root-id-1";
const FAKE_CORRELATION_ID = "run-root-id-1";

function recordingEvents(): {
  events: IApplyEventPublisher;
  calls: { method: string; arg: unknown }[];
} {
  const calls: { method: string; arg: unknown }[] = [];
  const events: IApplyEventPublisher = {
    async applyStarted(arg) {
      calls.push({ method: "applyStarted", arg });
      return {
        causationId: FAKE_RUN_ID,
        correlationId: FAKE_CORRELATION_ID,
      };
    },
    async resourceApplied(arg) {
      calls.push({ method: "resourceApplied", arg });
    },
    async applyCompleted(arg) {
      calls.push({ method: "applyCompleted", arg });
    },
    async applyFailed(arg) {
      calls.push({ method: "applyFailed", arg });
    },
  };
  return { events, calls };
}

function fakeWriters(overrides: Partial<PlatformResourceWriters> = {}): {
  writers: PlatformResourceWriters;
  callOrder: string[];
} {
  const callOrder: string[] = [];
  const alwaysCreateOk = {
    create: mock(async (_tenantId: string, resource: { name: string }) => {
      callOrder.push(resource.name);
      return {
        ok: true as const,
        value: { externalId: `ext-${resource.name}` },
      };
    }),
    update: mock(async (_tenantId: string, externalId: string) => ({
      ok: true as const,
      value: { externalId },
    })),
  };
  return {
    writers: {
      channel: alwaysCreateOk,
      connector: alwaysCreateOk,
      agent: alwaysCreateOk,
      service: alwaysCreateOk,
      workflow: alwaysCreateOk,
      ...overrides,
    },
    callOrder,
  };
}

function planWith(resources: ManifestPlan["resources"]): ManifestPlan {
  return { manifestName: "e2e-manifest-apply", resources, preconditions: [] };
}

describe("applyManifestPlan — T04 apply engine", () => {
  it("processes resources in the plan's dependency order", async () => {
    const manifest = manifestWith({ channel: "c1", workflow: "w1" });
    const { writers, callOrder } = fakeWriters();
    const { events } = recordingEvents();

    const plan = planWith([
      {
        kind: "channel",
        name: "c1",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "workflow",
        name: "w1",
        external: false,
        verdict: "create",
        diff: [],
      },
    ]);

    const result = await applyManifestPlan({
      manifest,
      tenantId: "tenant-a",
      plan,
      revision: 1,
      writers,
      events,
    });

    expect(result.ok).toBe(true);
    expect(callOrder).toEqual(["c1", "w1"]);
  });

  it("resume after partial failure: a second apply against a fresh plan only re-applies the pending resource", async () => {
    const manifest = manifestWith({
      channel: "c1",
      workflow: "w1",
      agent: "a1",
    });
    const { events } = recordingEvents();

    // First attempt: channel creation succeeds, workflow creation fails.
    const failingWorkflow = {
      create: mock(async () => ({
        ok: false as const,
        error: {
          kind: "downstream_error" as const,
          resourceKind: "workflow" as const,
          resourceName: "w1",
          message: "workflow-service unreachable",
        },
      })),
      update: mock(async (_t: string, externalId: string) => ({
        ok: true as const,
        value: { externalId },
      })),
    };
    const { writers: firstWriters, callOrder: firstCallOrder } = fakeWriters({
      workflow: failingWorkflow,
    });

    const firstPlan = planWith([
      {
        kind: "channel",
        name: "c1",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "workflow",
        name: "w1",
        external: false,
        verdict: "create",
        diff: [],
      },
      // Never reached — the workflow write above fails first.
      {
        kind: "agent",
        name: "a1",
        external: false,
        verdict: "create",
        diff: [],
      },
    ]);

    const firstResult = await applyManifestPlan({
      manifest,
      tenantId: "tenant-a",
      plan: firstPlan,
      revision: 1,
      writers: firstWriters,
      events,
    });

    expect(firstResult.ok).toBe(false);
    if (!firstResult.ok) {
      expect(firstResult.error.applied).toHaveLength(1);
      expect(firstResult.error.applied[0]).toMatchObject({
        kind: "channel",
        name: "c1",
        verdict: "create",
      });
      expect(firstResult.error.pending).toEqual([
        { kind: "agent", name: "a1", verdict: "create" },
      ]);
    }
    expect(firstCallOrder).toEqual(["c1"]);

    // Second attempt (simulating ApplyService re-planning against live
    // state): the channel AND the workflow now resolve live -> noop
    // (created by the writes above); only the agent is still pending.
    const { writers: secondWriters, callOrder: secondCallOrder } =
      fakeWriters();
    const secondPlan = planWith([
      {
        kind: "channel",
        name: "c1",
        external: false,
        verdict: "noop",
        diff: [],
        externalId: "ext-c1",
      },
      {
        kind: "workflow",
        name: "w1",
        external: false,
        verdict: "noop",
        diff: [],
        externalId: "ext-w1",
      },
      {
        kind: "agent",
        name: "a1",
        external: false,
        verdict: "create",
        diff: [],
      },
    ]);

    const secondResult = await applyManifestPlan({
      manifest,
      tenantId: "tenant-a",
      plan: secondPlan,
      revision: 2,
      writers: secondWriters,
      events,
    });

    expect(secondResult.ok).toBe(true);
    // Neither writer already-converged is called again — only the
    // still-pending agent is.
    expect(secondCallOrder).toEqual(["a1"]);
    if (secondResult.ok) {
      expect(secondResult.value.appliedCount).toBe(1);
      expect(secondResult.value.noopCount).toBe(2);
    }
  });

  it("noop stability: an all-noop plan never calls any writer", async () => {
    const manifest = manifestWith({ channel: "c1", workflow: "w1" });
    const { writers } = fakeWriters();
    const { events, calls } = recordingEvents();

    const plan = planWith([
      {
        kind: "channel",
        name: "c1",
        external: false,
        verdict: "noop",
        diff: [],
        externalId: "ext-c1",
      },
      {
        kind: "workflow",
        name: "w1",
        external: false,
        verdict: "noop",
        diff: [],
        externalId: "ext-w1",
      },
    ]);

    const result = await applyManifestPlan({
      manifest,
      tenantId: "tenant-a",
      plan,
      revision: 1,
      writers,
      events,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appliedCount).toBe(0);
      expect(result.value.noopCount).toBe(2);
      expect(result.value.resources.every((r) => r.verdict === "noop")).toBe(
        true
      );
    }
    expect(writers.channel.create).not.toHaveBeenCalled();
    expect(writers.workflow.create).not.toHaveBeenCalled();
    // No resource_applied for a noop-only run.
    expect(calls.filter((c) => c.method === "resourceApplied")).toHaveLength(0);
  });

  it("emits apply_started, resource_applied (only for create/update), and apply_completed on success", async () => {
    const manifest = manifestWith({ channel: "c1", workflow: "w1" });
    const { writers } = fakeWriters();
    const { events, calls } = recordingEvents();

    const plan = planWith([
      {
        kind: "channel",
        name: "c1",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "workflow",
        name: "w1",
        external: false,
        verdict: "noop",
        diff: [],
        externalId: "ext-w1",
      },
    ]);

    const result = await applyManifestPlan({
      manifest,
      tenantId: "tenant-a",
      plan,
      revision: 1,
      writers,
      events,
    });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual([
      "applyStarted",
      "resourceApplied",
      "applyCompleted",
    ]);
    expect(calls[0]?.arg).toMatchObject({
      manifestName: "e2e-manifest-apply",
      revision: 1,
      resourceCount: 2,
    });
    expect(calls[1]?.arg).toMatchObject({
      kind: "channel",
      name: "c1",
      verdict: "create",
      externalId: "ext-c1",
      // The engine threads the run root's causal context into every sibling
      // so they join ONE correlation chain (TAXONOMY.md rule 22 addendum).
      causationId: FAKE_RUN_ID,
      correlationId: FAKE_CORRELATION_ID,
    });
    expect(calls[2]?.arg).toMatchObject({
      manifestName: "e2e-manifest-apply",
      appliedCount: 1,
      noopCount: 1,
      causationId: FAKE_RUN_ID,
      correlationId: FAKE_CORRELATION_ID,
    });
  });

  it("emits apply_started and apply_failed (never apply_completed) when a resource write fails", async () => {
    const manifest = manifestWith({ channel: "c1" });
    const failingChannel = {
      create: mock(async () => ({
        ok: false as const,
        error: {
          kind: "secret_not_resolvable" as const,
          resourceKind: "channel" as const,
          resourceName: "c1",
          message: "secrets broker lands in T05",
        },
      })),
      update: mock(async (_t: string, externalId: string) => ({
        ok: true as const,
        value: { externalId },
      })),
    };
    const { writers } = fakeWriters({ channel: failingChannel });
    const { events, calls } = recordingEvents();

    const plan = planWith([
      {
        kind: "channel",
        name: "c1",
        external: false,
        verdict: "create",
        diff: [],
      },
    ]);

    const result = await applyManifestPlan({
      manifest,
      tenantId: "tenant-a",
      plan,
      revision: 1,
      writers,
      events,
    });

    expect(result.ok).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(["applyStarted", "applyFailed"]);
    expect(calls[1]?.arg).toMatchObject({
      manifestName: "e2e-manifest-apply",
      appliedSoFar: [],
      // apply_failed is a sibling of the run root too — same chain.
      causationId: FAKE_RUN_ID,
      correlationId: FAKE_CORRELATION_ID,
    });
    if (!result.ok) {
      expect(result.error.failure.kind).toBe("secret_not_resolvable");
    }
  });
});
