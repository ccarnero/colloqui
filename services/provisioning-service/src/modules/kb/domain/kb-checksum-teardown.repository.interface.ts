// Teardown-only port over `kb_document_checksums`
// (PENDIENTES/12-undeploy.spec.md T01 item 5): drop the checksum bookkeeping
// undeploy invalidates, so a later re-apply of the same manifest re-embeds
// from scratch instead of "skipping unchanged documents" whose knowledge base
// no longer exists.
//
// SEPARATE from `IKbChecksumRepository` for the same interface-segregation
// reason `manifest-teardown.repository.interface.ts` documents: the reconcile
// path's get/upsert contract has in-memory implementations (including the
// exported `createInMemoryKbChecksumRepository`) that have no business
// growing a bulk delete. The SAME `KbChecksumPostgresRepository` class
// implements both ports, so exactly one component touches the table.

export const KB_CHECKSUM_TEARDOWN_REPOSITORY = Symbol(
  "KB_CHECKSUM_TEARDOWN_REPOSITORY"
);

export interface IKbChecksumTeardownRepository {
  /**
   * Deletes every checksum row of `manifestName` for this tenant. Returns
   * the row count (0 when the manifest never had a knowledge base — never an
   * error).
   */
  deleteByManifest(tenantId: string, manifestName: string): Promise<number>;
}
