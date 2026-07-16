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

  async getLatest(
    tenantId: string,
    name: string
  ): Promise<IManifestRevision | null> {
    return this.rows.get(`${tenantId}::${name}`) ?? null;
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
});
