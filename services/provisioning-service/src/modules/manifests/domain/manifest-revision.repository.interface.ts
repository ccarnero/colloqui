import type { IntegrationManifest } from "@yoizen/shared";

export const MANIFEST_REVISION_REPOSITORY = Symbol(
  "MANIFEST_REVISION_REPOSITORY"
);

export interface IManifestRevision {
  id: string;
  tenantId: string;
  name: string;
  revision: number;
  manifest: IntegrationManifest;
  createdAt: string;
}

export interface IManifestRevisionRepository {
  /** Latest (highest-revision) row for `name`, or `null` if none exists yet. */
  getLatest(tenantId: string, name: string): Promise<IManifestRevision | null>;

  /**
   * Stores `manifest` as a new revision for `name` — never overwrites a
   * previous revision. Revision numbers are 1-based and monotonically
   * increasing per (tenantId, name).
   */
  createRevision(
    tenantId: string,
    name: string,
    manifest: IntegrationManifest
  ): Promise<IManifestRevision>;
}
