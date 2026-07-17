import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { HttpException } from "@nestjs/common";
import type { IntegrationManifest } from "@yoizen/shared";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import type { PlatformResourceClients } from "../../../src/modules/plan/domain/platform-resource-client.interface";
import { PlanController } from "../../../src/modules/plan/plan.controller";
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
      mcpServers: [],
      skills: [],
      workflows: [],
      secrets: [],
    },
  };
}

describe("PlanController", () => {
  it("POST /manifests/:name/plan returns the plan for a stored manifest", async () => {
    const repository = new FakeManifestRevisionRepository();
    await repository.createRevision("tenant-a", "demo", validManifest("demo"));
    const controller = new PlanController(
      new PlanService(repository, noopClients())
    );

    const plan = await controller.plan("tenant-a", "demo");
    expect(plan.manifestName).toBe("demo");
  });

  it("throws 404 when the manifest does not exist for this tenant", async () => {
    const controller = new PlanController(
      new PlanService(new FakeManifestRevisionRepository(), noopClients())
    );

    await expect(controller.plan("tenant-a", "missing")).rejects.toBeInstanceOf(
      HttpException
    );
  });
});
