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
