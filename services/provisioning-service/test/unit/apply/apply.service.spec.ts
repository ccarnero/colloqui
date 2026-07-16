import "../../setup-env";
import { beforeEach, describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { ApplyService } from "../../../src/modules/apply/apply.service";
import type { IApplyEventPublisher } from "../../../src/modules/apply/domain/apply-event-publisher.interface";
import type { PlatformResourceWriters } from "../../../src/modules/apply/domain/platform-resource-writer.interface";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import type { PlatformResourceClients } from "../../../src/modules/plan/domain/platform-resource-client.interface";

class FakeManifestRevisionRepository implements IManifestRevisionRepository {
  private readonly rows = new Map<string, IManifestRevision>();
  /** Number of `getLatest` calls, per key — lets a test assert the apply
   * engine loads the manifest EXACTLY ONCE (no mid-run re-fetch / TOCTOU). */
  readonly getLatestCalls = new Map<string, number>();

  async getLatest(
    tenantId: string,
    name: string
  ): Promise<IManifestRevision | null> {
    const key = `${tenantId}::${name}`;
    this.getLatestCalls.set(key, (this.getLatestCalls.get(key) ?? 0) + 1);
    return this.rows.get(key) ?? null;
  }

  async createRevision(
    tenantId: string,
    name: string,
    manifest: IntegrationManifest
  ): Promise<IManifestRevision> {
    const existing = this.rows.get(`${tenantId}::${name}`);
    const revision: IManifestRevision = {
      id: "id-1",
      tenantId,
      name,
      revision: (existing?.revision ?? 0) + 1,
      manifest,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(`${tenantId}::${name}`, revision);
    return revision;
  }
}

function alwaysMissClients(): PlatformResourceClients {
  const alwaysMiss = {
    findByName: async () => ({ ok: true as const, value: null }),
  };
  return {
    channel: alwaysMiss,
    connector: alwaysMiss,
    agent: alwaysMiss,
    service: alwaysMiss,
    systemVariable: alwaysMiss,
    workflow: alwaysMiss,
  };
}

function alwaysCreateWriters(): PlatformResourceWriters {
  const create = {
    create: async (_tenantId: string, resource: { name: string }) => ({
      ok: true as const,
      value: { externalId: `ext-${resource.name}` },
    }),
    update: async (_tenantId: string, externalId: string) => ({
      ok: true as const,
      value: { externalId },
    }),
  };
  return {
    channel: create,
    connector: create,
    agent: create,
    service: create,
    systemVariable: create,
    workflow: create,
  };
}

function recordingEvents(): {
  events: IApplyEventPublisher;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    events: {
      async applyStarted() {
        calls.push("applyStarted");
        return { causationId: "run-root", correlationId: "run-root" };
      },
      async resourceApplied() {
        calls.push("resourceApplied");
      },
      async applyCompleted() {
        calls.push("applyCompleted");
      },
      async applyFailed() {
        calls.push("applyFailed");
      },
    },
    calls,
  };
}

function validManifest(name: string): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name },
    spec: {
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      connectors: [],
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

describe("ApplyService", () => {
  let repository: FakeManifestRevisionRepository;

  beforeEach(() => {
    repository = new FakeManifestRevisionRepository();
  });

  it("returns a typed 'manifest_not_found' error when nothing was stored", async () => {
    const { events } = recordingEvents();
    const service = new ApplyService(
      repository,
      alwaysMissClients(),
      alwaysCreateWriters(),
      events
    );
    const result = await service.apply("tenant-a", "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("manifest_not_found");
    }
  });

  it("builds a fresh plan and applies every create-verdict resource", async () => {
    await repository.createRevision("tenant-a", "demo", validManifest("demo"));
    const { events, calls } = recordingEvents();
    const service = new ApplyService(
      repository,
      alwaysMissClients(),
      alwaysCreateWriters(),
      events
    );

    const result = await service.apply("tenant-a", "demo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appliedCount).toBe(2);
      expect(result.value.noopCount).toBe(0);
    }
    expect(calls).toEqual([
      "applyStarted",
      "resourceApplied",
      "resourceApplied",
      "applyCompleted",
    ]);
  });

  it("keeps applies isolated per tenant", async () => {
    await repository.createRevision(
      "tenant-a",
      "shared",
      validManifest("shared")
    );
    const { events } = recordingEvents();
    const service = new ApplyService(
      repository,
      alwaysMissClients(),
      alwaysCreateWriters(),
      events
    );

    const tenantBResult = await service.apply("tenant-b", "shared");
    expect(tenantBResult.ok).toBe(false);
    if (!tenantBResult.ok) {
      expect(tenantBResult.error.kind).toBe("manifest_not_found");
    }
  });

  it("re-applying the same manifest against live-matching state is a no-op (idempotent)", async () => {
    await repository.createRevision("tenant-a", "demo", validManifest("demo"));
    const { events } = recordingEvents();

    // Second call: clients now report both resources already exist with
    // matching fields -> the T03 planner marks everything `noop`.
    const alreadyLiveClients: PlatformResourceClients = {
      channel: {
        findByName: async () => ({
          ok: true,
          value: { externalId: "ext-http-in", fields: { type: "http" } },
        }),
      },
      connector: alwaysMissClients().connector,
      agent: {
        findByName: async () => ({
          ok: true,
          value: { externalId: "ext-agent-1", fields: {} },
        }),
      },
      service: alwaysMissClients().service,
      systemVariable: alwaysMissClients().systemVariable,
      workflow: alwaysMissClients().workflow,
    };
    const writers = alwaysCreateWriters();
    const service = new ApplyService(
      repository,
      alreadyLiveClients,
      writers,
      events
    );

    const result = await service.apply("tenant-a", "demo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appliedCount).toBe(0);
      expect(result.value.noopCount).toBe(2);
    }
    expect(writers.channel.create).toBeDefined();
  });

  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — HUMAN RULING
  // (decision 4): ALLOWLIST + KB-TREE WALK. End-to-end proof that a KB's
  // `ingestion_config.provider_connector_id` resolves to a connector CREATED
  // in the SAME apply (the ordering the pre-T03-gap-2 architecture could not
  // support — see `apply-manifest.ts`'s `reconcileKnowledgeBases` hook).
  describe("T03 gap 2 (gaps-2 SPEC): connector-before-KB dependency ordering", () => {
    function manifestWithConnectorAndKb(): IntegrationManifest {
      return {
        apiVersion: "yoizen.io/v1",
        kind: "IntegrationManifest",
        metadata: { name: "kb-demo" },
        spec: {
          channels: [],
          connectors: [{ name: "openai-main", type: "http" }],
          agents: [],
          knowledgeBases: [
            {
              name: "kb-support",
              ingestion_config: {
                provider_connector_id: { connectorRef: "openai-main" },
              },
              documents: [
                {
                  name: "faq",
                  source: { type: "inline", content: "Q: ...\nA: ..." },
                },
              ],
            },
          ],
          services: [],
          systemVariables: [],
          mcpServers: [],
          workflows: [],
          secrets: [],
        },
      };
    }

    function fakeKbReconciler(): {
      reconciler: IKnowledgeBaseReconciler;
      capturedResolvedConnectorId: { value?: string };
    } {
      const capturedResolvedConnectorId: { value?: string } = {};
      const reconciler: IKnowledgeBaseReconciler = {
        async reconcile(_t, _n, _m, _b, _c, resolveRef) {
          capturedResolvedConnectorId.value = resolveRef?.(
            "connectorRef" as SymbolicRefType,
            "openai-main"
          );
          return {
            ok: true,
            value: [
              { kbName: "kb-support", kbExternalId: "kb-ext-1", documents: [] },
            ],
          };
        },
      };
      return { reconciler, capturedResolvedConnectorId };
    }

    it("resolves a KB's provider_connector_id to the connector's fresh id and reports the KB outcome", async () => {
      await repository.createRevision(
        "tenant-a",
        "kb-demo",
        manifestWithConnectorAndKb()
      );
      const { events } = recordingEvents();
      const { reconciler, capturedResolvedConnectorId } = fakeKbReconciler();
      const service = new ApplyService(
        repository,
        alwaysMissClients(),
        alwaysCreateWriters(),
        events,
        reconciler
      );

      const result = await service.apply("tenant-a", "kb-demo");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appliedCount).toBe(1); // connector only
        expect(result.value.knowledgeBases).toEqual([
          { kbName: "kb-support", kbExternalId: "kb-ext-1", documents: [] },
        ]);
      }
      expect(capturedResolvedConnectorId.value).toBe("ext-openai-main");
    });

    it("surfaces a KB reconciliation failure through the standard ManifestApplyFailure envelope", async () => {
      await repository.createRevision(
        "tenant-a",
        "kb-demo",
        manifestWithConnectorAndKb()
      );
      const { events } = recordingEvents();
      const failingReconciler: IKnowledgeBaseReconciler = {
        async reconcile() {
          return {
            ok: false,
            error: {
              kind: "unresolved_symbolic_ref",
              kbName: "kb-support",
              message:
                "knowledgeBase 'kb-support' references unresolved connectorRef 'openai-main'",
            },
          };
        },
      };
      const service = new ApplyService(
        repository,
        alwaysMissClients(),
        alwaysCreateWriters(),
        events,
        failingReconciler
      );

      const result = await service.apply("tenant-a", "kb-demo");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("apply_failed");
        if (result.error.kind === "apply_failed") {
          expect(result.error.failure.kind).toBe("unresolved_symbolic_ref");
          expect(result.error.failure.resourceKind).toBe("knowledgeBase");
        }
      }
    });

    // Regression: a concurrent PUT mid-run must NOT change the manifest
    // snapshot the KB reconciler sees. `apply()` loads the revision ONCE at
    // the top and threads that exact snapshot into the KB hook — it never
    // re-queries `getLatest` mid-run (would be a TOCTOU race: KBs reconciled
    // against a newer revision than plan/execution were built from).
    it("reconciles KBs against the revision loaded at apply-start, even if a newer revision is PUT mid-run (no TOCTOU re-fetch)", async () => {
      // Revision 1: the manifest this apply run is built from.
      await repository.createRevision(
        "tenant-a",
        "kb-demo",
        manifestWithConnectorAndKb()
      );

      // A DIFFERENT revision 2 (different KB + connector names) that a
      // concurrent PUT lands mid-run. The fake repository returns whatever
      // was last written on the NEXT `getLatest` call — so if `apply()` (or
      // the KB hook) re-queried `getLatest`, it would wrongly pick this up.
      const rev2: IntegrationManifest = {
        apiVersion: "yoizen.io/v1",
        kind: "IntegrationManifest",
        metadata: { name: "kb-demo" },
        spec: {
          channels: [],
          connectors: [{ name: "rev2-connector", type: "http" }],
          agents: [],
          knowledgeBases: [
            {
              name: "rev2-kb",
              ingestion_config: {
                provider_connector_id: { connectorRef: "rev2-connector" },
              },
              documents: [
                {
                  name: "faq",
                  source: { type: "inline", content: "rev2" },
                },
              ],
            },
          ],
          services: [],
          systemVariables: [],
          mcpServers: [],
          workflows: [],
          secrets: [],
        },
      };

      const reconciledKbNames: string[] = [];
      const snoopingReconciler: IKnowledgeBaseReconciler = {
        async reconcile(_t, _n, manifest) {
          // Simulate the concurrent PUT landing exactly here (mid-run), AFTER
          // the initial load but BEFORE any subsequent getLatest would fire.
          await repository.createRevision("tenant-a", "kb-demo", rev2);
          for (const kb of manifest.spec.knowledgeBases) {
            reconciledKbNames.push(kb.name);
          }
          return {
            ok: true,
            value: manifest.spec.knowledgeBases.map((kb) => ({
              kbName: kb.name,
              kbExternalId: `ext-${kb.name}`,
              documents: [],
            })),
          };
        },
      };
      const { events } = recordingEvents();
      const service = new ApplyService(
        repository,
        alwaysMissClients(),
        alwaysCreateWriters(),
        events,
        snoopingReconciler
      );

      const result = await service.apply("tenant-a", "kb-demo");

      expect(result.ok).toBe(true);
      // The KB reconciler saw revision 1's KB, NOT revision 2's.
      expect(reconciledKbNames).toEqual(["kb-support"]);
      expect(reconciledKbNames).not.toContain("rev2-kb");
      // And `getLatest` ran EXACTLY ONCE for this manifest — the mid-run hook
      // never re-fetched (the rev2 PUT above is the only other write, via
      // createRevision, which does not count as a getLatest).
      expect(repository.getLatestCalls.get("tenant-a::kb-demo")).toBe(1);
    });
  });
});
