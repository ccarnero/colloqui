/**
 * Per-tenant RBAC and tenant user accounts DDL.
 * Single source of truth for auth-service `AuthTenantConnectionManager` and
 * tenant-service provisioning.
 *
 * `tenant_id` is intentionally absent: these tables live in each tenant's
 * Postgres. `UNIQUE(name)` on tenant_roles and `UNIQUE(email)` on tenant_users
 * replace the prior compound keys scoped by tenant_id.
 */
export const TENANT_AUTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenant_roles (
  id          TEXT        PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  description TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT false,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS tenant_role_permissions (
  id          TEXT        PRIMARY KEY,
  role_id     TEXT        NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  resource    VARCHAR(64) NOT NULL,
  action      VARCHAR(32) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_tenant_role_permissions_role
  ON tenant_role_permissions (role_id);

CREATE TABLE IF NOT EXISTS tenant_users (
  id            TEXT        PRIMARY KEY,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role_id       TEXT        NOT NULL REFERENCES tenant_roles(id),
  display_name  TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON tenant_users (email);
CREATE INDEX IF NOT EXISTS idx_tenant_users_role ON tenant_users (role_id);
`;
