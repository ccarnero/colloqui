import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import type { IKbChecksumTeardownRepository } from "../../../src/modules/kb/domain/kb-checksum-teardown.repository.interface";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import type { IManifestTeardownRepository } from "../../../src/modules/manifests/domain/manifest-teardown.repository.interface";
import { NOOP_SECRET_AUDIT_PUBLISHER } from "../../../src/modules/secrets/domain/secret-audit-publisher.interface";
import type { ISecretsStore } from "../../../src/modules/secrets/domain/secrets-store.interface";
import { SecretsService } from "../../../src/modules/secrets/secrets.service";
import type {
  IPlatformResourceDeleter,
  PlatformResourceDeleters,
} from "../../../src/modules/undeploy/domain/platform-resource-deleter.interface";
import { UndeployService } from "../../../src/modules/undeploy/undeploy.service";

function manifest(
  name: string,
  spec: Partial<IntegrationManifest["spec"]> = {}
): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name },
    spec: {
      channels: [],
      connectors: [],
      agents: [],
      knowledgeBases: [],
      services: [],
      systemVariables: [],
      mcpServers: [],
      skills: [],
      workflows: [],
      secrets: [],
      ...spec,
    },
  };
}

function revisionOf(m: IntegrationManifest): IManifestRevision {
  return {
    id: `id-${m.metadata.name}`,
    tenantId: "acme",
    name: m.metadata.name,
    revision: 1,
    manifest: m,
    createdAt: new Date().toISOString(),
  };
}

/** Stores whatever manifests the test seeds; records teardown calls. */
class FakeManifestStore
  implements IManifestRevisionRepository, IManifestTeardownRepository
{
  readonly deletedManifests: string[] = [];
  private readonly rows = new Map<string, IManifestRevision>();

  constructor(manifests: readonly IntegrationManifest[]) {
    for (const m of manifests) {
      this.rows.set(m.metadata.name, revisionOf(m));
    }
  }

  async getLatest(
    _tenantId: string,
    name: string
  ): Promise<IManifestRevision | null> {
    return this.rows.get(name) ?? null;
  }

  async createRevision(): Promise<IManifestRevision> {
    throw new Error("not used in these tests");
  }

  async listLatestManifests(): Promise<IManifestRevision[]> {
    return [...this.rows.values()];
  }

  async deleteManifest(_tenantId: string, name: string): Promise<number> {
    this.deletedManifests.push(name);
    return this.rows.delete(name) ? 1 : 0;
  }
}

class FakeChecksumTeardown implements IKbChecksumTeardownRepository {
  readonly calls: string[] = [];
  constructor(private readonly rows = 0) {}
  async deleteByManifest(
    _tenantId: string,
    manifestName: string
  ): Promise<number> {
    this.calls.push(manifestName);
    return this.rows;
  }
}

function deleterFor(
  live: Map<string, string>,
  kind: string
): IPlatformResourceDeleter {
  return {
    async findOwnedId(_tenantId, resourceName) {
      return { ok: true, value: live.get(`${kind}:${resourceName}`) ?? null };
    },
    async deleteById(_tenantId, _externalId, resourceName) {
      const existed = live.delete(`${kind}:${resourceName}`);
      return { ok: true, value: { deleted: existed } };
    },
  };
}

function deleters(live: Map<string, string>): PlatformResourceDeleters {
  return {
    channel: deleterFor(live, "channel"),
    connector: deleterFor(live, "connector"),
    agent: deleterFor(live, "agent"),
    workflow: deleterFor(live, "workflow"),
    knowledgeBase: deleterFor(live, "knowledgeBase"),
    service: deleterFor(live, "service"),
    mcpServer: deleterFor(live, "mcpServer"),
    skill: deleterFor(live, "skill"),
    systemVariable: deleterFor(live, "systemVariable"),
  };
}

function secretsService(): SecretsService {
  const keys = new Set<string>();
  const store: ISecretsStore = {
    async write(_tenantId, name, _value, scope) {
      keys.add(`${scope.kind}/${scope.owner}/${name}`);
      return { ok: true };
    },
    async deleteKey(_tenantId, name, scope) {
      const key = `${scope.kind}/${scope.owner}/${name}`;
      return { ok: true, value: { deleted: keys.delete(key) } };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async readResourceSecret() {
      return { ok: true, value: null };
    },
  };
  return new SecretsService(store, NOOP_SECRET_AUDIT_PUBLISHER);
}

const demo = (): IntegrationManifest =>
  manifest("demo", {
    channels: [{ name: "tg-in", type: "telegram", direction: "inbound" }],
    connectors: [{ name: "hubspot", type: "http" }],
  });

function liveFor(): Map<string, string> {
  return new Map([
    ["channel:tg-in", "ext-channel"],
    ["connector:hubspot", "ext-connector"],
  ]);
}

describe("UndeployService", () => {
  it("404s (typed) when the manifest is not stored for this tenant", async () => {
    const store = new FakeManifestStore([]);
    const service = new UndeployService(
      store,
      store,
      new FakeChecksumTeardown(),
      deleters(liveFor()),
      secretsService()
    );

    const result = await service.undeploy("acme", "missing");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toEqual({
      kind: "manifest_not_found",
      name: "missing",
    });
  });

  it("REFUSES with undeploy_blocked when another stored manifest references an owned resource", async () => {
    const dependent = manifest("crm-support", {
      connectors: [{ name: "hubspot", type: "http", external: true }],
    });
    const store = new FakeManifestStore([demo(), dependent]);
    const live = liveFor();
    const service = new UndeployService(
      store,
      store,
      new FakeChecksumTeardown(),
      deleters(live),
      secretsService()
    );

    const result = await service.undeploy("acme", "demo");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("undeploy_blocked");
    if (result.error.kind !== "undeploy_blocked") {
      return;
    }
    expect(result.error.dependents).toEqual([
      {
        manifestName: "crm-support",
        resourceKind: "connector",
        resourceName: "hubspot",
      },
    ]);
    expect(result.error.message).toContain("crm-support");
    // Nothing was deleted, and the manifest record still stands.
    expect(live.size).toBe(2);
    expect(store.deletedManifests).toEqual([]);
    expect(await store.getLatest("acme", "demo")).not.toBeNull();
  });

  it("deletes the checksum rows and the stored manifest LAST on a fully successful run", async () => {
    const store = new FakeManifestStore([demo()]);
    const checksums = new FakeChecksumTeardown(3);
    const service = new UndeployService(
      store,
      store,
      checksums,
      deleters(liveFor()),
      secretsService()
    );

    const result = await service.undeploy("acme", "demo");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.deletedCount).toBe(2);
    expect(result.value.checksumRowsDeleted).toBe(3);
    expect(result.value.manifestRecordDeleted).toBe(true);
    expect(checksums.calls).toEqual(["demo"]);
    expect(store.deletedManifests).toEqual(["demo"]);
    expect(await store.getLatest("acme", "demo")).toBeNull();
    expect(typeof result.value.durationMs).toBe("number");
  });

  it("KEEPS the stored manifest (and the checksum rows) when a resource delete fails", async () => {
    const store = new FakeManifestStore([demo()]);
    const checksums = new FakeChecksumTeardown(3);
    const live = liveFor();
    const failing = deleters(live);
    const connectorDeleter = failing.connector;
    if (!connectorDeleter) {
      throw new Error("fixture must wire a connector deleter");
    }
    connectorDeleter.deleteById = async () => ({
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: "hubspot",
        message: "HTTP 500 from connector-admin",
      },
    });

    const service = new UndeployService(
      store,
      store,
      checksums,
      failing,
      secretsService()
    );

    const result = await service.undeploy("acme", "demo");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("undeploy_failed");
    expect(checksums.calls).toEqual([]);
    expect(store.deletedManifests).toEqual([]);
    expect(await store.getLatest("acme", "demo")).not.toBeNull();
  });

  it("is safe to run twice: the second run 404s because the record is gone, live state untouched", async () => {
    const store = new FakeManifestStore([demo()]);
    const live = liveFor();
    const service = new UndeployService(
      store,
      store,
      new FakeChecksumTeardown(),
      deleters(live),
      secretsService()
    );

    const first = await service.undeploy("acme", "demo");
    const second = await service.undeploy("acme", "demo");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.error.kind).toBe("manifest_not_found");
    expect(live.size).toBe(0);
  });

  it("re-running after a partial failure resumes from live state and then completes", async () => {
    const store = new FakeManifestStore([demo()]);
    const live = liveFor();
    const flaky = deleters(live);
    // The channel is the LAST target (reverse order is connector -> channel),
    // so the first attempt deletes the connector and then dies on it.
    const channelDeleter = flaky.channel;
    if (!channelDeleter) {
      throw new Error("fixture must wire a channel deleter");
    }
    const workingDelete = channelDeleter.deleteById;
    let failNext = true;
    channelDeleter.deleteById = async (tenantId, externalId, name) => {
      if (failNext) {
        failNext = false;
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "channel",
            resourceName: name,
            message: "HTTP 503 from channel-service",
          },
        };
      }
      return workingDelete(tenantId, externalId, name);
    };

    const service = new UndeployService(
      store,
      store,
      new FakeChecksumTeardown(),
      flaky,
      secretsService()
    );

    const first = await service.undeploy("acme", "demo");
    expect(first.ok).toBe(false);

    const second = await service.undeploy("acme", "demo");
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    // The connector was already deleted by the first attempt; the channel,
    // which the first attempt failed on, is deleted by the second.
    expect(
      second.value.resources.find((r) => r.name === "hubspot")?.action
    ).toBe("not_found");
    expect(second.value.resources.find((r) => r.name === "tg-in")?.action).toBe(
      "deleted"
    );
    expect(second.value.manifestRecordDeleted).toBe(true);
  });

  it("surfaces a dependency cycle without deleting anything", async () => {
    const cyclic = manifest("cyclic", {
      channels: [
        {
          name: "tg-in",
          type: "telegram",
          direction: "inbound",
          config: { agentRef: "support-agent" },
        },
      ],
      agents: [
        {
          name: "support-agent",
          profile: { handoff: { channelRef: "tg-in" } },
        },
      ],
    });
    const store = new FakeManifestStore([cyclic]);
    const live = new Map([
      ["channel:tg-in", "ext-channel"],
      ["agent:support-agent", "ext-agent"],
    ]);
    const service = new UndeployService(
      store,
      store,
      new FakeChecksumTeardown(),
      deleters(live),
      secretsService()
    );

    const result = await service.undeploy("acme", "cyclic");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("cycle_detected");
    expect(live.size).toBe(2);
    expect(store.deletedManifests).toEqual([]);
  });
});
