import { PostgresModule as BasePostgresModule } from "@yoizen/database";

export { POSTGRES_SQL } from "@yoizen/database";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS registered_services (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  image               TEXT        NOT NULL,
  port                INTEGER     NOT NULL DEFAULT 3000,
  min_scale           INTEGER     NOT NULL DEFAULT 0,
  max_scale           INTEGER     NOT NULL DEFAULT 10,
  concurrency_target  INTEGER     NOT NULL DEFAULT 100,
  env_vars            JSONB       NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'pending',
  knative_name        TEXT,
  namespace           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_reg_svc_tenant ON registered_services (tenant_id);
CREATE INDEX IF NOT EXISTS idx_reg_svc_status ON registered_services (status);

CREATE TABLE IF NOT EXISTS service_routes (
  id              TEXT        PRIMARY KEY,
  service_id      TEXT        NOT NULL REFERENCES registered_services(id) ON DELETE CASCADE,
  path_prefix     TEXT        NOT NULL,
  methods         TEXT[]      NOT NULL DEFAULT '{GET,POST,PUT,PATCH,DELETE}',
  is_public       BOOLEAN     NOT NULL DEFAULT false,
  strip_prefix    BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_id, path_prefix)
);
CREATE INDEX IF NOT EXISTS idx_svc_routes_service ON service_routes (service_id);

CREATE TABLE IF NOT EXISTS canary_deployments (
  id              TEXT        PRIMARY KEY,
  service_id      TEXT        NOT NULL REFERENCES registered_services(id) ON DELETE CASCADE,
  stable_revision TEXT        NOT NULL,
  canary_revision TEXT        NOT NULL,
  canary_percent  INTEGER     NOT NULL DEFAULT 0 CHECK (canary_percent BETWEEN 0 AND 100),
  status          TEXT        NOT NULL DEFAULT 'progressing',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_canary_service ON canary_deployments (service_id);
`;

export const PostgresModule = BasePostgresModule.register({
  defaultHost:
    "postgres.support-services-dev.svc.cluster.local",
  schemaSql: [SCHEMA_SQL],
});
