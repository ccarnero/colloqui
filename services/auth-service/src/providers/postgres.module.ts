import type { DynamicModule } from "@nestjs/common";
import {
  PostgresModule as BasePostgresModule,
  PLATFORM_POSTGRES_POOL_OPTIONS,
} from "@yoizen/database";

/**
 * Platform Postgres DDL for auth-service (subset of shared platform catalog).
 * Mirrors `PLATFORM_MONGO_SCHEMA` auth/registry collections in SQL form.
 */
const AUTH_PLATFORM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS platform_users (
  id            TEXT        PRIMARY KEY,
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'operator',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users (email);

CREATE TABLE IF NOT EXISTS api_clients (
  id                 TEXT        PRIMARY KEY,
  client_id          TEXT        UNIQUE NOT NULL,
  client_secret_hash TEXT        NOT NULL,
  name               TEXT        NOT NULL,
  scope              TEXT        NOT NULL,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_clients_client_id ON api_clients (client_id);
CREATE INDEX IF NOT EXISTS idx_api_clients_scope ON api_clients (scope);

CREATE TABLE IF NOT EXISTS public_routes (
  id            TEXT        PRIMARY KEY,
  method        TEXT        NOT NULL,
  path_pattern  TEXT        NOT NULL,
  scope         TEXT        NOT NULL,
  environment   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_routes_scope_env ON public_routes (scope, environment);
CREATE INDEX IF NOT EXISTS idx_public_routes_env ON public_routes (environment);

CREATE TABLE IF NOT EXISTS tenants (
  id                        TEXT        PRIMARY KEY,
  name                      TEXT        UNIQUE NOT NULL,
  tier                      TEXT        NOT NULL DEFAULT 'shared'
                            CHECK (tier IN ('shared', 'dedicated')),
  configuration             JSONB       NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provisioning_status       TEXT        NOT NULL DEFAULT 'pending',
  provisioning_error        TEXT,
  provisioning_started_at   TIMESTAMPTZ,
  provisioning_completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants (name);
`;

export { POSTGRES_SQL } from "@yoizen/database";

export const AuthPostgresModule: DynamicModule = BasePostgresModule.register({
  ...PLATFORM_POSTGRES_POOL_OPTIONS,
  schemaSql: [AUTH_PLATFORM_SCHEMA_SQL],
});
