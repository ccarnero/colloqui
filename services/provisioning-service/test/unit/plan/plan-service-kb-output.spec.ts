import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { validateManifest } from "@yoizen/shared";
import type {
  IKbChecksumRepository,
  KbDocumentChecksumRow,
} from "../../../src/modules/kb/domain/kb-checksum-repository.interface";
import { createInMemoryKbChecksumRepository } from "../../../src/modules/kb/domain/kb-checksum-repository.interface";
import type {
  IManifestRevision,
  IManifestRevisionRepository,
} from "../../../src/modules/manifests/domain/manifest-revision.repository.interface";
import type { PlatformResourceClients } from "../../../src/modules/plan/domain/platform-resource-client.interface";
import { PlanService } from "../../../src/modules/plan/plan.service";

function noopClients(): PlatformResourceClients {
  const alwaysMiss = {
    findByName: async () => ({ ok: true as const, value: null }),
  };
  return {
    channel: alwaysMiss,
    connector: alwaysMiss,
    agent: alwaysMiss,
    service: alwaysMiss,
    workflow: alwaysMiss,
  };
}

/** Stores a pre-validated manifest as a single revision — models the live
 * PUT->plan round trip (the manifest is parsed by the real T01 validator, as
 * `ManifestsService.putManifest` does, so the shape matches production). */
class FixedManifestRepository implements IManifestRevisionRepository {
  constructor(private readonly manifest: IntegrationManifest) {}
  async getLatest(): Promise<IManifestRevision | null> {
    return {
      id: "id-1",
      tenantId: "tenant-a",
      name: "demo",
      revision: 2,
      manifest: this.manifest,
      createdAt: new Date().toISOString(),
    };
  }
  async createRevision(): Promise<IManifestRevision> {
    throw new Error("not used in this test");
  }
}

function kbManifest(inlineContent: string): IntegrationManifest {
  const parsed = validateManifest({
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "demo" },
    spec: {
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      workflows: [
        { name: "wf", definition: { application: "demo", actions: [] } },
      ],
      knowledgeBases: [
        {
          name: "kb-1",
          documents: [
            { name: "faq", source: { type: "inline", content: inlineContent } },
            {
              name: "manual",
              source: { type: "file", path: "m.txt", sha256: "a".repeat(64) },
            },
          ],
        },
      ],
    },
  });
  if (!parsed.ok) {
    throw new Error(
      `fixture manifest invalid: ${JSON.stringify(parsed.error)}`
    );
  }
  return parsed.value;
}

describe("PlanService — KB plan output (the exact live plan-endpoint path)", () => {
  it("includes knowledgeBases with reembedCount on the plan result (the e2e's assertion target)", async () => {
    const service = new PlanService(
      new FixedManifestRepository(kbManifest("hello world")),
      noopClients()
    );

    const result = await service.plan("tenant-a", "demo");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Serialize exactly as the controller returns it over HTTP — this is
    // what the e2e reads via `.knowledgeBases[0].reembedCount`.
    const serialized = JSON.parse(JSON.stringify(result.value));
    expect(serialized.knowledgeBases).toHaveLength(1);
    expect(serialized.knowledgeBases[0].reembedCount).toBe(2);
    expect(serialized.knowledgeBases[0].documents).toHaveLength(2);
  });

  it("reports exactly one re-embed when one document changed and one is unchanged", async () => {
    // Seed the checksum repo so 'faq' (content 'v1') is already applied and
    // 'manual' (file sha 'aaaa...') is already applied — then re-plan with a
    // CHANGED faq content: only faq should re-embed.
    const checksumRepo: IKbChecksumRepository =
      createInMemoryKbChecksumRepository();
    const { computeSha256 } = await import(
      "../../../src/modules/kb/lib/compute-sha256"
    );
    const seededFaq: KbDocumentChecksumRow = {
      sha256: computeSha256("v1"),
      kbExternalId: "kb-ext-1",
      documentExternalId: "doc-faq",
    };
    const seededManual: KbDocumentChecksumRow = {
      sha256: "a".repeat(64),
      kbExternalId: "kb-ext-1",
      documentExternalId: "doc-manual",
    };
    await checksumRepo.upsertChecksum(
      "tenant-a",
      "demo",
      "kb-1",
      "faq",
      seededFaq
    );
    await checksumRepo.upsertChecksum(
      "tenant-a",
      "demo",
      "kb-1",
      "manual",
      seededManual
    );

    const service = new PlanService(
      new FixedManifestRepository(kbManifest("v2-changed")),
      noopClients(),
      undefined,
      checksumRepo
    );

    const result = await service.plan("tenant-a", "demo");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const kb = result.value.knowledgeBases?.[0];
    expect(kb?.reembedCount).toBe(1);
    const actions = Object.fromEntries(
      (kb?.documents ?? []).map((d) => [d.documentName, d.action])
    );
    expect(actions.faq).toBe("reembed");
    expect(actions.manual).toBe("skip");
  });

  it("degrades to an all-create KB plan (never 500s) when the checksum repo throws", async () => {
    const throwingRepo: IKbChecksumRepository = {
      async getChecksum() {
        throw new Error("relation kb_document_checksums does not exist");
      },
      async upsertChecksum() {},
    };

    const service = new PlanService(
      new FixedManifestRepository(kbManifest("hello world")),
      noopClients(),
      undefined,
      throwingRepo
    );

    const result = await service.plan("tenant-a", "demo");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.knowledgeBases?.[0]?.reembedCount).toBe(2);
  });
});
