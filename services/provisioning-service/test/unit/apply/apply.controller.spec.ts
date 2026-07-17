import "../../setup-env";
import { describe, expect, it } from "bun:test";
import { HttpException } from "@nestjs/common";
import type { IntegrationManifest } from "@yoizen/shared";
import { ApplyController } from "../../../src/modules/apply/apply.controller";
import { ApplyService } from "../../../src/modules/apply/apply.service";
import { NOOP_APPLY_EVENT_PUBLISHER } from "../../../src/modules/apply/domain/apply-event-publisher.interface";
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

function validManifest(name: string): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name },
    spec: {
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      connectors: [],
      agents: [],
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

describe("ApplyController", () => {
  it("POST /manifests/:name/apply applies a stored manifest and returns the summary", async () => {
    const repository = new FakeManifestRevisionRepository();
    await repository.createRevision("tenant-a", "demo", validManifest("demo"));
    const controller = new ApplyController(
      new ApplyService(
        repository,
        noopClients(),
        alwaysCreateWriters(),
        NOOP_APPLY_EVENT_PUBLISHER
      )
    );

    const result = await controller.apply("tenant-a", "demo");
    expect(result).toMatchObject({ manifestName: "demo", appliedCount: 1 });
  });

  it("throws 404 when the manifest does not exist for this tenant", async () => {
    const controller = new ApplyController(
      new ApplyService(
        new FakeManifestRevisionRepository(),
        noopClients(),
        alwaysCreateWriters(),
        NOOP_APPLY_EVENT_PUBLISHER
      )
    );

    await expect(
      controller.apply("tenant-a", "missing")
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("throws 409 with applied/pending when a resource write fails", async () => {
    const repository = new FakeManifestRevisionRepository();
    await repository.createRevision("tenant-a", "demo", validManifest("demo"));
    const failingWriters = alwaysCreateWriters();
    failingWriters.channel.create = async () => ({
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "channel",
        resourceName: "http-in",
        message: "channel-service unreachable",
      },
    });
    const controller = new ApplyController(
      new ApplyService(
        repository,
        noopClients(),
        failingWriters,
        NOOP_APPLY_EVENT_PUBLISHER
      )
    );

    try {
      await controller.apply("tenant-a", "demo");
      throw new Error("expected apply to throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      const httpException = thrown as HttpException;
      expect(httpException.getStatus()).toBe(409);
    }
  });
});
