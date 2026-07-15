// Port for T06's checksum reconciliation bookkeeping. This is
// provisioning-service's OWN tenant-scoped table (`kb_document_checksums`,
// mirrors `manifest_revisions`'s pattern) — it never writes to
// agent-admin-service's tables directly (SPEC.md constraint); it only
// remembers "last sha256 + externalIds we applied for this manifest/kb/doc"
// so a re-apply can skip re-embedding unchanged documents.

export interface KbDocumentChecksumRow {
  readonly sha256: string;
  readonly kbExternalId: string;
  readonly documentExternalId: string;
}

export interface IKbChecksumRepository {
  /** `null` when this (manifest, kb, document) triple has never been applied. */
  getChecksum(
    tenantId: string,
    manifestName: string,
    kbName: string,
    documentName: string
  ): Promise<KbDocumentChecksumRow | null>;

  upsertChecksum(
    tenantId: string,
    manifestName: string,
    kbName: string,
    documentName: string,
    row: KbDocumentChecksumRow
  ): Promise<void>;
}

export const KB_CHECKSUM_REPOSITORY = Symbol("KB_CHECKSUM_REPOSITORY");

/** In-memory no-op for tests and for PlanService's optional injection default. */
export function createInMemoryKbChecksumRepository(): IKbChecksumRepository {
  const rows = new Map<string, KbDocumentChecksumRow>();
  const key = (t: string, m: string, kb: string, doc: string) =>
    `${t}::${m}::${kb}::${doc}`;
  return {
    async getChecksum(tenantId, manifestName, kbName, documentName) {
      return (
        rows.get(key(tenantId, manifestName, kbName, documentName)) ?? null
      );
    },
    async upsertChecksum(tenantId, manifestName, kbName, documentName, row) {
      rows.set(key(tenantId, manifestName, kbName, documentName), row);
    },
  };
}
