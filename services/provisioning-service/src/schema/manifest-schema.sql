-- Tenant-scoped storage for declarative-provisioning manifests. One row per
-- revision so `PUT /manifests/:name` never mutates history and `GET
-- /manifests/:name` can always return the current (highest-revision) row.
-- `tenant_id` is kept as a column (in addition to the tenant-scoped DB
-- itself) for defense-in-depth, matching agent-memory-service /
-- registry-service convention.
CREATE TABLE IF NOT EXISTS manifest_revisions (
  id UUID PRIMARY KEY,
  tenant_id VARCHAR(32) NOT NULL,
  name VARCHAR(63) NOT NULL,
  revision INTEGER NOT NULL,
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name, revision)
);

CREATE INDEX IF NOT EXISTS idx_manifest_revisions_tenant_name
  ON manifest_revisions (tenant_id, name, revision DESC);

-- T06: checksum-reconciliation bookkeeping for KB documents. This is
-- provisioning-service's OWN bookkeeping — it never mirrors agent-admin's
-- `documents` table, only remembers "last sha256 + externalIds we applied"
-- for this (tenant, manifest, kb, document) so a re-apply can skip
-- re-embedding unchanged content (SPEC.md decision 6).
CREATE TABLE IF NOT EXISTS kb_document_checksums (
  tenant_id VARCHAR(32) NOT NULL,
  manifest_name VARCHAR(63) NOT NULL,
  kb_name VARCHAR(63) NOT NULL,
  document_name VARCHAR(63) NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  kb_external_id VARCHAR(128) NOT NULL,
  document_external_id VARCHAR(128) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, manifest_name, kb_name, document_name)
);
