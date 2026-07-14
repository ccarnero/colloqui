import "../setup-env";
import { beforeEach, describe, expect, it } from "bun:test";
import { HttpException } from "@nestjs/common";
import type { IntegrationManifest } from "@yoizen/shared";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../src/modules/manifests/domain/manifest-revision.repository.interface";
import { ManifestsController } from "../../src/modules/manifests/manifests.controller";
import { ManifestsService } from "../../src/modules/manifests/manifests.service";

class FakeManifestRevisionRepository implements IManifestRevisionRepository {
  private readonly rows = new Map<string, IManifestRevision[]>();

  private key(tenantId: string, name: string): string {
    return `${tenantId}::${name}`;
  }

  async getLatest(
    tenantId: string,
    name: string
  ): Promise<IManifestRevision | null> {
    const revisions = this.rows.get(this.key(tenantId, name)) ?? [];
    return revisions.at(-1) ?? null;
  }

  async createRevision(
    tenantId: string,
    name: string,
    manifest: IntegrationManifest
  ): Promise<IManifestRevision> {
    const key = this.key(tenantId, name);
    const revisions = this.rows.get(key) ?? [];
    const revision: IManifestRevision = {
      id: `id-${String(revisions.length + 1)}`,
      tenantId,
      name,
      revision: revisions.length + 1,
      manifest,
      createdAt: new Date().toISOString(),
    };
    revisions.push(revision);
    this.rows.set(key, revisions);
    return revision;
  }
}

function validManifest(name = "demo"): unknown {
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
      workflows: [],
      secrets: [],
    },
  };
}

describe("ManifestsController", () => {
  let controller: ManifestsController;

  beforeEach(() => {
    const service = new ManifestsService(new FakeManifestRevisionRepository());
    controller = new ManifestsController(service);
  });

  it("POST /manifests/validate returns valid:true for a good manifest", () => {
    const result = controller.validate("tenant-a", validManifest());
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("POST /manifests/validate returns typed errors for a bad manifest", () => {
    const result = controller.validate("tenant-a", { not: "a manifest" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("PUT /manifests/:name stores and GET /manifests/:name reads it back", async () => {
    const stored = await controller.put(
      "tenant-a",
      "demo",
      validManifest("demo")
    );
    expect(stored.revision).toBe(1);

    const fetched = await controller.get("tenant-a", "demo");
    expect(fetched.revision).toBe(1);
    expect(fetched.manifest.metadata.name).toBe("demo");
  });

  it("PUT /manifests/:name throws 400 with the error list on invalid input", async () => {
    await expect(
      controller.put("tenant-a", "demo", { not: "a manifest" })
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("GET /manifests/:name throws 404 when nothing was stored for this tenant", async () => {
    await expect(controller.get("tenant-a", "missing")).rejects.toBeInstanceOf(
      HttpException
    );
  });

  it("keeps PUT/GET isolated per tenant even with the same name", async () => {
    await controller.put("tenant-a", "shared", validManifest("shared"));
    await expect(controller.get("tenant-b", "shared")).rejects.toBeInstanceOf(
      HttpException
    );

    await controller.put("tenant-b", "shared", validManifest("shared"));
    const tenantAFetch = await controller.get("tenant-a", "shared");
    const tenantBFetch = await controller.get("tenant-b", "shared");
    expect(tenantAFetch.tenantId).toBe("tenant-a");
    expect(tenantBFetch.tenantId).toBe("tenant-b");
  });
});
