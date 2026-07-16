import "../../setup-env";
import { beforeEach, describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import type { PlatformResourceClients } from "../../../src/modules/plan/domain/platform-resource-client.interface";
import { PlanService } from "../../../src/modules/plan/plan.service";

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
    const revision: IManifestRevision = {
      id: "id-1",
      tenantId,
      name,
      revision: 1,
      manifest,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(`${tenantId}::${name}`, revision);
    return revision;
  }
}

function noopClients(): PlatformResourceClients {
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

describe("PlanService", () => {
  let repository: FakeManifestRevisionRepository;
  let service: PlanService;

  beforeEach(() => {
    repository = new FakeManifestRevisionRepository();
    service = new PlanService(repository, noopClients());
  });

  it("returns a typed 'manifest_not_found' error when nothing was stored", async () => {
    const result = await service.plan("tenant-a", "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("manifest_not_found");
    }
  });

  it("builds a plan from the latest stored revision", async () => {
    await repository.createRevision("tenant-a", "demo", validManifest("demo"));
    const result = await service.plan("tenant-a", "demo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifestName).toBe("demo");
      expect(result.value.resources.every((r) => r.verdict === "create")).toBe(
        true
      );
    }
  });

  it("keeps plans isolated per tenant", async () => {
    await repository.createRevision(
      "tenant-a",
      "shared",
      validManifest("shared")
    );
    const tenantBResult = await service.plan("tenant-b", "shared");
    expect(tenantBResult.ok).toBe(false);
  });
});
