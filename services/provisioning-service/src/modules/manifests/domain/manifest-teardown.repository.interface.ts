// Teardown-only port over `manifest_revisions`
// (PENDIENTES/12-undeploy.spec.md T01) — the two reads/writes undeploy needs
// that no other caller has ever needed: "every manifest stored for this
// tenant" (the decision-4 shared-resource guard) and "drop this manifest's
// rows" (the LAST step of a fully successful undeploy).
//
// SEPARATE from `IManifestRevisionRepository` on purpose (interface
// segregation, not a parallel data path): the SAME
// `ManifestRevisionPostgresRepository` class implements both, so there is
// still exactly ONE component touching the table. Widening the existing port
// instead would force the seven in-memory fakes that implement it across the
// plan/apply/manifests suites to grow two methods they never exercise, for
// no gain in the production wiring.

import type { IManifestRevision } from "./manifest-revision.repository.interface";

export const MANIFEST_TEARDOWN_REPOSITORY = Symbol(
  "MANIFEST_TEARDOWN_REPOSITORY"
);

export interface IManifestTeardownRepository {
  /**
   * The LATEST revision of EVERY manifest stored for this tenant — one row
   * per manifest name. Used only to scan other manifests for `external: true`
   * references to the resources of the manifest being undeployed.
   */
  listLatestManifests(tenantId: string): Promise<IManifestRevision[]>;

  /**
   * Deletes EVERY revision of `name` for this tenant. Returns the number of
   * rows removed (0 when the manifest was already gone — never an error, the
   * verb is idempotent by decision 6). Called LAST, and only when every
   * non-skipped resource outcome succeeded.
   */
  deleteManifest(tenantId: string, name: string): Promise<number>;
}
