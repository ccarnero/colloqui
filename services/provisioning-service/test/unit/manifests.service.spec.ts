import "../setup-env";
import { beforeEach, describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../src/modules/manifests/domain/manifest-revision.repository.interface";
import { ManifestsService } from "../../src/modules/manifests/manifests.service";

/**
 * In-memory fake repository, keyed by `${tenantId}::${name}`, so tests can
 * assert tenant isolation without a real Postgres instance (docker/
 * testcontainers unavailable in this sandbox — see PR notes).
 */
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

// manual-loops/provisioning-manifest-gaps-2.md T01, gap 1 — a
// channel-less/process-less manifest declaring `kind: LibraryManifest`,
// valid only because it declares at least one real resource (a connector).
function validLibraryManifest(name = "lib-demo"): unknown {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "LibraryManifest",
    metadata: { name },
    spec: {
      channels: [],
      connectors: [{ name: "http-connector", type: "http" }],
      agents: [],
      knowledgeBases: [],
      services: [],
      workflows: [],
      secrets: [],
    },
  };
}

describe("ManifestsService", () => {
  let repository: FakeManifestRevisionRepository;
  let service: ManifestsService;

  beforeEach(() => {
    repository = new FakeManifestRevisionRepository();
    service = new ManifestsService(repository);
  });

  describe("validate", () => {
    it("returns ok for a structurally valid manifest", () => {
      const result = service.validate(validManifest());
      expect(result.ok).toBe(true);
    });

    it("surfaces typed errors for an unknown-key manifest", () => {
      const invalid = validManifest();
      (invalid as { extra?: string }).extra = "not allowed";
      const result = service.validate(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.length).toBeGreaterThan(0);
        expect(result.error[0]).toHaveProperty("path");
        expect(result.error[0]).toHaveProperty("message");
      }
    });

    it("surfaces structural-rule errors (no inbound channel)", () => {
      const manifest = validManifest() as {
        spec: { channels: unknown[] };
      };
      manifest.spec.channels = [];
      const result = service.validate(manifest);
      expect(result.ok).toBe(false);
    });

    // manual-loops/provisioning-manifest-gaps-2.md T01, gap 1
    it("returns ok for a library manifest with zero channels/processes but a real resource", () => {
      const result = service.validate(validLibraryManifest());
      expect(result.ok).toBe(true);
    });

    it("surfaces structural-rule errors for a library manifest with zero resources of any kind", () => {
      const manifest = validLibraryManifest() as {
        spec: { connectors: unknown[] };
      };
      manifest.spec.connectors = [];
      const result = service.validate(manifest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.error.some((e) => /library manifest/.test(e.message))
        ).toBe(true);
      }
    });
  });

  describe("putManifest / getManifest — revision round-trip", () => {
    it("stores a manifest and reads it back as revision 1", async () => {
      const putResult = await service.putManifest(
        "tenant-a",
        "demo",
        validManifest("demo")
      );
      expect(putResult.ok).toBe(true);
      if (putResult.ok) {
        expect(putResult.value.revision).toBe(1);
      }

      const fetched = await service.getManifest("tenant-a", "demo");
      expect(fetched).not.toBeNull();
      expect(fetched?.revision).toBe(1);
      expect(fetched?.manifest.metadata.name).toBe("demo");
    });

    it("increments the revision on a second put and getManifest returns the latest", async () => {
      await service.putManifest("tenant-a", "demo", validManifest("demo"));
      const second = await service.putManifest(
        "tenant-a",
        "demo",
        validManifest("demo")
      );
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.revision).toBe(2);
      }

      const fetched = await service.getManifest("tenant-a", "demo");
      expect(fetched?.revision).toBe(2);
    });

    it("rejects a put when the route name does not match metadata.name", async () => {
      const result = await service.putManifest(
        "tenant-a",
        "route-name",
        validManifest("different-name")
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0]?.path).toBe("metadata.name");
      }
    });

    it("rejects a put with an invalid manifest before touching storage", async () => {
      const result = await service.putManifest("tenant-a", "demo", {
        not: "a manifest",
      });
      expect(result.ok).toBe(false);

      const fetched = await service.getManifest("tenant-a", "demo");
      expect(fetched).toBeNull();
    });

    it("returns null from getManifest when nothing was ever stored", async () => {
      const fetched = await service.getManifest("tenant-a", "missing");
      expect(fetched).toBeNull();
    });

    // manual-loops/provisioning-manifest-gaps-2.md T01, gap 1 — the `kind`
    // marker round-trips through the stored-manifest path unchanged.
    it("round-trips kind: LibraryManifest through PUT and GET", async () => {
      const putResult = await service.putManifest(
        "tenant-a",
        "lib-demo",
        validLibraryManifest("lib-demo")
      );
      expect(putResult.ok).toBe(true);

      const fetched = await service.getManifest("tenant-a", "lib-demo");
      expect(fetched?.manifest.kind).toBe("LibraryManifest");
    });
  });

  describe("tenant isolation", () => {
    it("keeps manifests of the same name isolated per tenant", async () => {
      await service.putManifest(
        "tenant-a",
        "shared-name",
        validManifest("shared-name")
      );
      const tenantBFetch = await service.getManifest("tenant-b", "shared-name");
      expect(tenantBFetch).toBeNull();

      await service.putManifest(
        "tenant-b",
        "shared-name",
        validManifest("shared-name")
      );
      const tenantAFetch = await service.getManifest("tenant-a", "shared-name");
      const tenantBFetchAfter = await service.getManifest(
        "tenant-b",
        "shared-name"
      );

      expect(tenantAFetch?.tenantId).toBe("tenant-a");
      expect(tenantAFetch?.revision).toBe(1);
      expect(tenantBFetchAfter?.tenantId).toBe("tenant-b");
      expect(tenantBFetchAfter?.revision).toBe(1);
    });
  });
});
