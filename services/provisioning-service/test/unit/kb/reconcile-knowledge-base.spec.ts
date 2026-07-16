import { describe, expect, it } from "bun:test";
import { createInMemoryKbBlobStore } from "../../../src/modules/kb/domain/kb-blob-store.interface";
import { createInMemoryKbChecksumRepository } from "../../../src/modules/kb/domain/kb-checksum-repository.interface";
import type {
  AgentAdminDocumentSummary,
  AgentAdminKbSummary,
  IAgentAdminKbClient,
} from "../../../src/modules/kb/infrastructure/agent-admin-kb-client";
import { createKnowledgeBaseReconciler } from "../../../src/modules/kb/lib/reconcile-knowledge-base";

function fakeKbClient(): {
  client: IAgentAdminKbClient;
  createdKbs: string[];
  createdIngestionConfigs: (Record<string, unknown> | undefined)[];
  uploadedTextDocs: { kbId: string; filename: string; content: string }[];
  uploadedFileDocs: { kbId: string; filename: string }[];
  deletedDocs: string[];
} {
  const kbsByName = new Map<string, AgentAdminKbSummary>();
  const documentsByKb = new Map<string, AgentAdminDocumentSummary[]>();
  const createdKbs: string[] = [];
  const createdIngestionConfigs: (Record<string, unknown> | undefined)[] = [];
  const uploadedTextDocs: {
    kbId: string;
    filename: string;
    content: string;
  }[] = [];
  const uploadedFileDocs: { kbId: string; filename: string }[] = [];
  const deletedDocs: string[] = [];
  let nextId = 1;

  const client: IAgentAdminKbClient = {
    async findKbByName(_tenantId, name) {
      return { ok: true, value: kbsByName.get(name) ?? null };
    },
    async createKb(_tenantId, name, ingestionConfig) {
      const kb = { id: `kb-${String(nextId++)}`, name };
      kbsByName.set(name, kb);
      createdKbs.push(name);
      createdIngestionConfigs.push(ingestionConfig);
      return { ok: true, value: kb };
    },
    async listDocuments(_tenantId, kbId) {
      return { ok: true, value: documentsByKb.get(kbId) ?? [] };
    },
    async uploadTextDocument(_tenantId, kbId, filename, contentText) {
      const doc = {
        id: `doc-${String(nextId++)}`,
        original_filename: filename,
      };
      documentsByKb.set(kbId, [...(documentsByKb.get(kbId) ?? []), doc]);
      uploadedTextDocs.push({ kbId, filename, content: contentText });
      return { ok: true, value: { documentId: doc.id } };
    },
    async uploadFileDocument(_tenantId, kbId, filename) {
      const doc = {
        id: `doc-${String(nextId++)}`,
        original_filename: filename,
      };
      documentsByKb.set(kbId, [...(documentsByKb.get(kbId) ?? []), doc]);
      uploadedFileDocs.push({ kbId, filename });
      return { ok: true, value: { documentId: doc.id } };
    },
    async deleteDocument(_tenantId, _kbId, documentId) {
      deletedDocs.push(documentId);
      return { ok: true, value: undefined };
    },
  };

  return {
    client,
    createdKbs,
    createdIngestionConfigs,
    uploadedTextDocs,
    uploadedFileDocs,
    deletedDocs,
  };
}

describe("createKnowledgeBaseReconciler", () => {
  it("creates a new KB and uploads a never-seen inline document", async () => {
    const { client, createdKbs, uploadedTextDocs } = fakeKbClient();
    const reconciler = createKnowledgeBaseReconciler({
      kbClient: client,
      checksumRepository: createInMemoryKbChecksumRepository(),
      blobStore: createInMemoryKbBlobStore(),
    });

    const manifest = {
      spec: {
        knowledgeBases: [
          {
            name: "kb-support",
            documents: [
              {
                name: "faq",
                source: { type: "inline" as const, content: "Q: ...\nA: ..." },
              },
            ],
          },
        ],
      },
    };

    const result = await reconciler.reconcile(
      "tenant-a",
      "demo",
      manifest,
      undefined,
      undefined
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.kbName).toBe("kb-support");
      expect(result.value[0]?.documents[0]).toMatchObject({
        documentName: "faq",
        action: "create",
      });
    }
    expect(createdKbs).toEqual(["kb-support"]);
    expect(uploadedTextDocs).toHaveLength(1);
  });

  it("skips re-uploading a document whose checksum is unchanged (idempotent re-apply)", async () => {
    const { client, uploadedTextDocs } = fakeKbClient();
    const checksumRepository = createInMemoryKbChecksumRepository();
    const reconciler = createKnowledgeBaseReconciler({
      kbClient: client,
      checksumRepository,
      blobStore: createInMemoryKbBlobStore(),
    });

    const manifest = {
      spec: {
        knowledgeBases: [
          {
            name: "kb-support",
            documents: [
              {
                name: "faq",
                source: { type: "inline" as const, content: "same content" },
              },
            ],
          },
        ],
      },
    };

    const first = await reconciler.reconcile(
      "tenant-a",
      "demo",
      manifest,
      undefined,
      undefined
    );
    expect(first.ok).toBe(true);
    expect(uploadedTextDocs).toHaveLength(1);

    const second = await reconciler.reconcile(
      "tenant-a",
      "demo",
      manifest,
      undefined,
      undefined
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value[0]?.documents[0]?.action).toBe("skip");
    }
    // Still only ONE upload total — the second apply is a no-op for this document.
    expect(uploadedTextDocs).toHaveLength(1);
  });

  it("re-embeds ONLY the changed document, deleting the superseded version", async () => {
    const { client, uploadedTextDocs, deletedDocs } = fakeKbClient();
    const checksumRepository = createInMemoryKbChecksumRepository();
    const reconciler = createKnowledgeBaseReconciler({
      kbClient: client,
      checksumRepository,
      blobStore: createInMemoryKbBlobStore(),
    });

    const firstManifest = {
      spec: {
        knowledgeBases: [
          {
            name: "kb-support",
            documents: [
              {
                name: "faq",
                source: { type: "inline" as const, content: "version 1" },
              },
              {
                name: "policy",
                source: { type: "inline" as const, content: "unchanged" },
              },
            ],
          },
        ],
      },
    };
    await reconciler.reconcile(
      "tenant-a",
      "demo",
      firstManifest,
      undefined,
      undefined
    );
    expect(uploadedTextDocs).toHaveLength(2);

    const secondManifest = {
      spec: {
        knowledgeBases: [
          {
            name: "kb-support",
            documents: [
              {
                name: "faq",
                source: { type: "inline" as const, content: "version 2" },
              },
              {
                name: "policy",
                source: { type: "inline" as const, content: "unchanged" },
              },
            ],
          },
        ],
      },
    };
    const result = await reconciler.reconcile(
      "tenant-a",
      "demo",
      secondManifest,
      undefined,
      undefined
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const outcomes = result.value[0]?.documents ?? [];
      expect(outcomes.find((o) => o.documentName === "faq")?.action).toBe(
        "reembed"
      );
      expect(outcomes.find((o) => o.documentName === "policy")?.action).toBe(
        "skip"
      );
    }
    // Only the changed document ("faq") triggered a new upload + a delete of its old version.
    expect(uploadedTextDocs).toHaveLength(3);
    expect(deletedDocs).toHaveLength(1);
  });

  it("resolves a file source from the bundle, verifying the declared sha256", async () => {
    const { client, uploadedFileDocs } = fakeKbClient();
    const reconciler = createKnowledgeBaseReconciler({
      kbClient: client,
      checksumRepository: createInMemoryKbChecksumRepository(),
      blobStore: createInMemoryKbBlobStore(),
    });

    const { computeSha256 } = await import(
      "../../../src/modules/kb/lib/compute-sha256"
    );
    const fileContent = Buffer.from("PDF bytes", "utf8");
    const bundle = new Map([["docs/manual.pdf", fileContent]]);

    const manifest = {
      spec: {
        knowledgeBases: [
          {
            name: "kb-support",
            documents: [
              {
                name: "manual",
                source: {
                  type: "file" as const,
                  path: "docs/manual.pdf",
                  sha256: computeSha256(fileContent),
                },
              },
            ],
          },
        ],
      },
    };

    const result = await reconciler.reconcile(
      "tenant-a",
      "demo",
      manifest,
      bundle,
      undefined
    );
    expect(result.ok).toBe(true);
    expect(uploadedFileDocs).toHaveLength(1);
  });

  it("surfaces a document resolution failure as a typed error without writing anything", async () => {
    const { client, uploadedFileDocs } = fakeKbClient();
    const reconciler = createKnowledgeBaseReconciler({
      kbClient: client,
      checksumRepository: createInMemoryKbChecksumRepository(),
      blobStore: createInMemoryKbBlobStore(),
    });

    const manifest = {
      spec: {
        knowledgeBases: [
          {
            name: "kb-support",
            documents: [
              {
                name: "manual",
                source: {
                  type: "file" as const,
                  path: "docs/missing.pdf",
                  sha256: "a".repeat(64),
                },
              },
            ],
          },
        ],
      },
    };

    const result = await reconciler.reconcile(
      "tenant-a",
      "demo",
      manifest,
      undefined,
      undefined
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("document_resolve_failed");
    }
    expect(uploadedFileDocs).toHaveLength(0);
  });

  it("skips reconciliation entirely for an external knowledge base", async () => {
    const { client, createdKbs } = fakeKbClient();
    const reconciler = createKnowledgeBaseReconciler({
      kbClient: client,
      checksumRepository: createInMemoryKbChecksumRepository(),
      blobStore: createInMemoryKbBlobStore(),
    });

    const manifest = {
      spec: {
        knowledgeBases: [
          { name: "kb-external", external: true, documents: [] },
        ],
      },
    };

    const result = await reconciler.reconcile(
      "tenant-a",
      "demo",
      manifest,
      undefined,
      undefined
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
    expect(createdKbs).toEqual([]);
  });

  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2.
  describe("ingestion_config connectorRef substitution (T03, gap 2)", () => {
    it("substitutes provider_connector_id and forwards it to createKb when CREATING a new KB", async () => {
      const { client, createdIngestionConfigs } = fakeKbClient();
      const reconciler = createKnowledgeBaseReconciler({
        kbClient: client,
        checksumRepository: createInMemoryKbChecksumRepository(),
        blobStore: createInMemoryKbBlobStore(),
      });

      const manifest = {
        spec: {
          knowledgeBases: [
            {
              name: "kb-support",
              ingestion_config: {
                provider_connector_id: { connectorRef: "openai-main" },
              },
              documents: [
                {
                  name: "faq",
                  source: {
                    type: "inline" as const,
                    content: "Q: ...\nA: ...",
                  },
                },
              ],
            },
          ],
        },
      };

      const result = await reconciler.reconcile(
        "tenant-a",
        "demo",
        manifest,
        undefined,
        undefined,
        (refType, name) =>
          refType === "connectorRef" && name === "openai-main"
            ? "connector-real-id-1"
            : undefined
      );

      expect(result.ok).toBe(true);
      expect(createdIngestionConfigs).toHaveLength(1);
      expect(createdIngestionConfigs[0]).toEqual({
        provider_connector_id: "connector-real-id-1",
      });
    });

    it("fails loud (unresolved_symbolic_ref) and never calls createKb when the connector has no real id yet", async () => {
      const { client, createdKbs } = fakeKbClient();
      const reconciler = createKnowledgeBaseReconciler({
        kbClient: client,
        checksumRepository: createInMemoryKbChecksumRepository(),
        blobStore: createInMemoryKbBlobStore(),
      });

      const manifest = {
        spec: {
          knowledgeBases: [
            {
              name: "kb-support",
              ingestion_config: {
                provider_connector_id: { connectorRef: "openai-main" },
              },
              documents: [
                {
                  name: "faq",
                  source: {
                    type: "inline" as const,
                    content: "Q: ...\nA: ...",
                  },
                },
              ],
            },
          ],
        },
      };

      const result = await reconciler.reconcile(
        "tenant-a",
        "demo",
        manifest,
        undefined,
        undefined,
        () => undefined
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("unresolved_symbolic_ref");
        expect(result.error.kbName).toBe("kb-support");
      }
      expect(createdKbs).toEqual([]);
    });

    it("never touches ingestion_config for an already-existing KB (pre-existing 'no mutable KB fields' limitation, unchanged)", async () => {
      const { client, createdKbs, createdIngestionConfigs } = fakeKbClient();
      // Pre-seed the KB as already existing.
      await client.createKb("tenant-a", "kb-support");
      createdKbs.length = 0;
      createdIngestionConfigs.length = 0;

      const reconciler = createKnowledgeBaseReconciler({
        kbClient: client,
        checksumRepository: createInMemoryKbChecksumRepository(),
        blobStore: createInMemoryKbBlobStore(),
      });

      const manifest = {
        spec: {
          knowledgeBases: [
            {
              name: "kb-support",
              ingestion_config: {
                provider_connector_id: { connectorRef: "openai-main" },
              },
              documents: [
                {
                  name: "faq",
                  source: {
                    type: "inline" as const,
                    content: "Q: ...\nA: ...",
                  },
                },
              ],
            },
          ],
        },
      };

      // No resolveRef supplied at all — if the existing-KB path attempted
      // substitution it would throw/fail; it must not even try.
      const result = await reconciler.reconcile(
        "tenant-a",
        "demo",
        manifest,
        undefined,
        undefined
      );

      expect(result.ok).toBe(true);
      expect(createdKbs).toEqual([]);
      expect(createdIngestionConfigs).toEqual([]);
    });
  });
});
