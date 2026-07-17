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
      systemVariables: [],
      mcpServers: [],
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

// manual-loops/provisioning-manifest-gaps.md T03, gap 3 — manifest-time
// real-ID substitution wired into the apply loop.
describe("applyManifestPlan — T03 manifest-time real-ID substitution", () => {
  function manifestWithConnectorAndWorkflow(): IntegrationManifest {
    return {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [{ name: "hubspot", type: "http" }],
        agents: [],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [
          {
            name: "w1",
            definition: {
              application: "e2e",
              actions: [
                {
                  activity: "endpointCall",
                  name: "call-hubspot",
                  args: {
                    adapterId: { connectorRef: "hubspot" },
                    method: "GET",
                    url: "/contacts",
                  },
                },
              ],
            },
          },
        ],
        secrets: [],
      },
    };
  }

  it("a workflow referencing a connector created in the SAME apply gets the fresh id (dependency-order)", async () => {
    const manifest = manifestWithConnectorAndWorkflow();
    let capturedWorkflowResource: unknown;
    const writers: PlatformResourceWriters = {
      channel: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      connector: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "connector-real-id-42" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      agent: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      service: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      workflow: {
        create: mock(async (_t: string, resource: unknown) => {
          capturedWorkflowResource = resource;
          return { ok: true as const, value: { externalId: "wf-real-id-1" } };
        }),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
    };
    const { events } = recordingEvents();

    const plan = planWith([
      {
        kind: "connector",
        name: "hubspot",
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
    const substitutedDefinition = (
      capturedWorkflowResource as {
        definition: { actions: { args: { adapterId: unknown } }[] };
      }
    ).definition;
    expect(substitutedDefinition.actions[0]?.args.adapterId).toBe(
      "connector-real-id-42"
    );
  });

  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — `connectorId`
  // ADDED to SUBSTITUTION_ALLOWLIST. Sits inside an agent's own
  // `profile.model_config.llm.connectorId`, already covered by the
  // PRE-EXISTING agent-`profile` tree walk (`build-substituted-resource.ts`)
  // — this is a NEW allowlist entry, not a new tree root.
  it("an agent's profile.model_config.llm.connectorId resolves to the connector created in the SAME apply", async () => {
    const manifest: IntegrationManifest = {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [{ name: "openai-main", type: "http" }],
        agents: [
          {
            name: "support-agent",
            profile: {
              model_config: {
                llm: { connectorId: { connectorRef: "openai-main" } },
              },
            },
          },
        ],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [],
        secrets: [],
      },
    };
    let capturedAgentResource: unknown;
    const { writers } = fakeWriters({
      connector: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "connector-real-id-7" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      agent: {
        create: mock(async (_t: string, resource: unknown) => {
          capturedAgentResource = resource;
          return {
            ok: true as const,
            value: { externalId: "agent-real-id-1" },
          };
        }),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
    });
    const { events } = recordingEvents();

    const plan = planWith([
      {
        kind: "connector",
        name: "openai-main",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "agent",
        name: "support-agent",
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
    const substitutedProfile = (
      capturedAgentResource as {
        profile: { model_config: { llm: { connectorId: unknown } } };
      }
    ).profile;
    expect(substitutedProfile.model_config.llm.connectorId).toBe(
      "connector-real-id-7"
    );
    // Stored-manifest immutability holds for this NEW allowlist entry too.
    expect(
      (
        manifest.spec.agents[0]?.profile as {
          model_config: { llm: { connectorId: unknown } };
        }
      ).model_config.llm.connectorId
    ).toEqual({ connectorRef: "openai-main" });
  });

  // manual-loops/provisioning-manifest-gaps-2.md T07 batch B, live-gate
  // regression: the PRODUCTION scenario the sibling test above does NOT cover
  // — the LLM connector already exists live (verdict "noop"), so the agent is
  // the ONLY resource written. The noop branch of `applyManifestPlan`
  // populates `resolvedIds` from `entry.externalId` WITHOUT ever invoking a
  // writer, and the agent's `profile.model_config.llm.connectorId` must STILL
  // resolve to that pre-existing connector's real id. If substitution were
  // skipped (e.g. `connectorId` dropped from SUBSTITUTION_ALLOWLIST, or the
  // agent-`profile` tree walk regressed), the raw `{ connectorRef }` object
  // would reach the agent writer verbatim and agent-admin-service would
  // stringify it to `[object Object]` — the exact HTTP 400 observed live. The
  // capture asserts on `resource.profile.model_config.llm.connectorId` because
  // that is precisely what the REAL `agents-writer.ts` copies into the POST
  // body (`body.model_config = agent.profile.model_config`), so this fake
  // mirrors the real wiring's read.
  it("an agent's profile.model_config.llm.connectorId resolves against a PRE-EXISTING (noop) connector — no writer for the connector", async () => {
    const manifest: IntegrationManifest = {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [{ name: "openai-main", type: "http" }],
        agents: [
          {
            name: "support-agent",
            profile: {
              model_config: {
                llm: { connectorId: { connectorRef: "openai-main" } },
              },
            },
          },
        ],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [],
        secrets: [],
      },
    };
    let capturedAgentResource: unknown;
    const connectorCreate = mock(async () => ({
      ok: true as const,
      value: { externalId: "should-never-be-called" },
    }));
    const connectorUpdate = mock(async (_t: string, id: string) => ({
      ok: true as const,
      value: { externalId: id },
    }));
    const { writers } = fakeWriters({
      connector: { create: connectorCreate, update: connectorUpdate },
      agent: {
        create: mock(async (_t: string, resource: unknown) => {
          capturedAgentResource = resource;
          return {
            ok: true as const,
            value: { externalId: "agent-real-id-1" },
          };
        }),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
    });
    const { events } = recordingEvents();

    // Connector is NOOP with its live externalId already known (the exact
    // shape `build-manifest-plan.ts` produces when `findByName` locates an
    // already-live connector whose fields match the manifest's desired shape).
    const plan = planWith([
      {
        kind: "connector",
        name: "openai-main",
        external: false,
        verdict: "noop",
        externalId: "b4df2eb6-connector-real-id",
        diff: [],
      },
      {
        kind: "agent",
        name: "support-agent",
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
    // The connector was noop — no writer call for it at all.
    expect(connectorCreate).not.toHaveBeenCalled();
    expect(connectorUpdate).not.toHaveBeenCalled();
    // The agent body carries the RESOLVED id STRING, never the ref object.
    const substitutedProfile = (
      capturedAgentResource as {
        profile: { model_config: { llm: { connectorId: unknown } } };
      }
    ).profile;
    expect(substitutedProfile.model_config.llm.connectorId).toBe(
      "b4df2eb6-connector-real-id"
    );
    expect(typeof substitutedProfile.model_config.llm.connectorId).toBe(
      "string"
    );
  });

  it("stored-manifest immutability: the original manifest's workflow definition is never mutated by substitution", async () => {
    const manifest = manifestWithConnectorAndWorkflow();
    const originalDefinitionSnapshot = JSON.parse(
      JSON.stringify(manifest.spec.workflows[0]?.definition)
    );
    const writers: PlatformResourceWriters = {
      channel: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      connector: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "connector-real-id-42" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      agent: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      service: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      workflow: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "wf-real-id-1" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
    };
    const { events } = recordingEvents();

    const plan = planWith([
      {
        kind: "connector",
        name: "hubspot",
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
    // GET /manifests/:name reads straight off this same in-memory object —
    // asserting it is byte-for-byte unchanged after apply is the
    // stored-manifest-immutability guarantee.
    expect(manifest.spec.workflows[0]?.definition).toEqual(
      originalDefinitionSnapshot
    );
  });

  it("unresolved connectorRef fails loud and never calls the workflow writer", async () => {
    // Connector is declared `external` in the plan but never resolves —
    // no create/update ever ran for it, so `resolvedIds` has nothing for
    // "connector:hubspot" by the time the workflow is reached.
    const manifest = manifestWithConnectorAndWorkflow();
    const workflowWriter = {
      create: mock(async () => ({
        ok: true as const,
        value: { externalId: "should-never-be-called" },
      })),
      update: mock(async (_t: string, id: string) => ({
        ok: true as const,
        value: { externalId: id },
      })),
    };
    const writers: PlatformResourceWriters = {
      channel: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      connector: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      agent: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      service: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      workflow: workflowWriter,
    };
    const { events, calls } = recordingEvents();

    // The connector never appears in the plan at all (simulating a
    // dependency-order gap / missing precondition) — the workflow's
    // adapterId substitution has no resolved id available.
    const plan = planWith([
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.failure.message).toContain("connectorRef");
      expect(result.error.failure.message).toContain("hubspot");
    }
    expect(workflowWriter.create).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual(["applyStarted", "applyFailed"]);
  });

  it("a wrong-kind ref-object at an allowlisted key fails loud and never calls the workflow writer", async () => {
    const manifest: IntegrationManifest = {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [],
        agents: [],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [
          {
            name: "w1",
            definition: {
              application: "e2e",
              actions: [
                {
                  activity: "channelSend",
                  name: "send",
                  // accountId only accepts channelRef; agentRef here is a
                  // mismatched symbolic ref that must fail loud.
                  args: { accountId: { agentRef: "support-agent" } },
                },
              ],
            },
          },
        ],
        secrets: [],
      },
    };
    const workflowWriter = {
      create: mock(async () => ({
        ok: true as const,
        value: { externalId: "should-never-be-called" },
      })),
      update: mock(async (_t: string, id: string) => ({
        ok: true as const,
        value: { externalId: id },
      })),
    };
    const { writers } = fakeWriters({ workflow: workflowWriter });
    const { events, calls } = recordingEvents();

    const plan = planWith([
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.kind).toBe("mismatched_symbolic_ref");
      expect(result.error.failure.message).toContain("channelRef");
      expect(result.error.failure.message).toContain("agentRef");
    }
    expect(workflowWriter.create).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual(["applyStarted", "applyFailed"]);
  });

  // manual-loops/provisioning-manifest-gaps-2.md T02, gap 3, decision 5
  // ruling (FAIL LOUD).
  it("a ref-object at a non-allowlisted key fails loud (unallowlisted_symbolic_ref) and never calls the workflow writer", async () => {
    const manifest: IntegrationManifest = {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [],
        agents: [],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [
          {
            name: "w1",
            definition: {
              application: "e2e",
              actions: [
                {
                  activity: "endpointCall",
                  name: "call",
                  args: {
                    // manual-loops/provisioning-manifest-gaps-2.md T03,
                    // gap 2 ADDED `connectorId`/`provider_connector_id` to
                    // SUBSTITUTION_ALLOWLIST (the ORIGINAL example key this
                    // T02 test used, now legitimately allowlisted — see this
                    // file's T03 gap-2 tests for its NEW allowlisted
                    // behavior). `some_unrelated_arg` is NOT (and never has
                    // been) in SUBSTITUTION_ALLOWLIST, keeping this test's
                    // coverage of the non-allowlisted-key path intact.
                    some_unrelated_arg: { connectorRef: "hubspot" },
                    method: "GET",
                    url: "/x",
                  },
                },
              ],
            },
          },
        ],
        secrets: [],
      },
    };
    const workflowWriter = {
      create: mock(async () => ({
        ok: true as const,
        value: { externalId: "should-never-be-called" },
      })),
      update: mock(async (_t: string, id: string) => ({
        ok: true as const,
        value: { externalId: id },
      })),
    };
    const { writers } = fakeWriters({ workflow: workflowWriter });
    const { events, calls } = recordingEvents();

    const plan = planWith([
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.kind).toBe("unallowlisted_symbolic_ref");
      expect(result.error.failure.message).toContain("some_unrelated_arg");
      expect(result.error.failure.message).toContain("connectorRef");
      expect(result.error.failure.message).toContain("hubspot");
    }
    expect(workflowWriter.create).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual(["applyStarted", "applyFailed"]);
  });
});

// manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — HUMAN RULING
// (decision 4): ALLOWLIST + KB-TREE WALK. `reconcileKnowledgeBases` moved KB
// reconciliation FROM strictly-before-the-plan (T06) TO mid-loop, right
// after every "connector"-kind resource resolves and before "mcpServer"/
// "agent" (RESOURCE_KIND_ORDER) — these tests cover the hook's boundary and
// fail-loud/back-compat contracts directly (KB substitution itself is
// covered by `substitute-kb-ingestion-config.spec.ts` /
// `reconcile-knowledge-base.spec.ts`).
describe("applyManifestPlan — T03 gap 2 (gaps-2 SPEC): reconcileKnowledgeBases hook", () => {
  function connectorAndAgentWriters(): {
    writers: PlatformResourceWriters;
    callOrder: string[];
  } {
    const callOrder: string[] = [];
    const make = (name: string) => ({
      create: mock(async () => {
        callOrder.push(name);
        return { ok: true as const, value: { externalId: `ext-${name}` } };
      }),
      update: mock(async (_t: string, id: string) => ({
        ok: true as const,
        value: { externalId: id },
      })),
    });
    return {
      writers: {
        channel: make("channel"),
        connector: make("connector"),
        agent: make("agent"),
        service: make("service"),
        workflow: make("workflow"),
      },
      callOrder,
    };
  }

  function manifestWithConnectorAndAgent(): IntegrationManifest {
    return {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [{ name: "hubspot", type: "http" }],
        agents: [{ name: "agent-1", profile: {} }],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [],
        secrets: [],
      },
    };
  }

  it("is called AFTER the connector resource resolves and BEFORE the agent resource, with the connector's fresh resolvedIds", async () => {
    const manifest = manifestWithConnectorAndAgent();
    const { writers, callOrder } = connectorAndAgentWriters();
    const { events } = recordingEvents();
    let capturedResolvedIds: ReadonlyMap<string, string> | undefined;

    const plan = planWith([
      {
        kind: "connector",
        name: "hubspot",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "agent",
        name: "agent-1",
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
      reconcileKnowledgeBases: async (connectorResolvedIds) => {
        capturedResolvedIds = connectorResolvedIds;
        callOrder.push("kb-hook");
        return {
          ok: true,
          value: { externalIdsByName: new Map(), outcomes: [] },
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(callOrder).toEqual(["connector", "kb-hook", "agent"]);
    expect(capturedResolvedIds?.get("connector:hubspot")).toBe("ext-connector");
  });

  it("is still called (fallback, after the loop) when the plan has NO resource ranked after 'connector'", async () => {
    const manifest: IntegrationManifest = {
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: "e2e-manifest-apply" },
      spec: {
        channels: [],
        connectors: [{ name: "hubspot", type: "http" }],
        agents: [],
        knowledgeBases: [],
        services: [],
        systemVariables: [],
        mcpServers: [],
        workflows: [],
        secrets: [],
      },
    };
    const { writers } = connectorAndAgentWriters();
    const { events } = recordingEvents();
    let hookCalls = 0;

    const plan = planWith([
      {
        kind: "connector",
        name: "hubspot",
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
      reconcileKnowledgeBases: async () => {
        hookCalls++;
        return {
          ok: true,
          value: { externalIdsByName: new Map(), outcomes: [] },
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(hookCalls).toBe(1);
  });

  it("a hook failure fails loud through ManifestApplyFailure and the agent writer is never called", async () => {
    const manifest = manifestWithConnectorAndAgent();
    const { writers, callOrder } = connectorAndAgentWriters();
    const { events, calls } = recordingEvents();

    const plan = planWith([
      {
        kind: "connector",
        name: "hubspot",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "agent",
        name: "agent-1",
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
      reconcileKnowledgeBases: async () => ({
        ok: false,
        error: {
          kind: "unresolved_symbolic_ref",
          resourceKind: "knowledgeBase",
          resourceName: "kb-support",
          message:
            "knowledgeBase 'kb-support' references unresolved connectorRef 'openai-main'",
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.failure.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.failure.resourceKind).toBe("knowledgeBase");
    }
    expect(callOrder).toEqual(["connector"]);
    expect(writers.agent.create).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual([
      "applyStarted",
      "resourceApplied",
      "applyFailed",
    ]);
  });

  it("back-compat: knowledgeBaseExternalIdsByName still threads into the agent writer's context when reconcileKnowledgeBases is omitted", async () => {
    const manifest = manifestWithConnectorAndAgent();
    let capturedContext:
      | { knowledgeBaseExternalIds?: ReadonlyMap<string, string> }
      | undefined;
    const writers: PlatformResourceWriters = {
      channel: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      connector: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "ext-connector" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      agent: {
        create: mock(
          async (
            _t: string,
            _r: unknown,
            context?: { knowledgeBaseExternalIds?: ReadonlyMap<string, string> }
          ) => {
            capturedContext = context;
            return { ok: true as const, value: { externalId: "ext-agent" } };
          }
        ),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      service: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
      workflow: {
        create: mock(async () => ({
          ok: true as const,
          value: { externalId: "n/a" },
        })),
        update: mock(async (_t: string, id: string) => ({
          ok: true as const,
          value: { externalId: id },
        })),
      },
    };
    const { events } = recordingEvents();

    const plan = planWith([
      {
        kind: "connector",
        name: "hubspot",
        external: false,
        verdict: "create",
        diff: [],
      },
      {
        kind: "agent",
        name: "agent-1",
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
      knowledgeBaseExternalIdsByName: new Map([["kb-support", "kb-ext-1"]]),
    });

    expect(result.ok).toBe(true);
    expect(capturedContext?.knowledgeBaseExternalIds?.get("kb-support")).toBe(
      "kb-ext-1"
    );
  });
});
