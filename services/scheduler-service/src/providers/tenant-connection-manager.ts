import { Injectable } from "@nestjs/common";
import { TenantConnectionManager as BaseTenantConnectionManager } from "@yoizen/database";

export type { Sql } from "@yoizen/database";

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS schedules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    type         TEXT NOT NULL CHECK (type IN ('cron', 'interval', 'one-time')),
    expression   TEXT NOT NULL,
    exec_mode    TEXT NOT NULL CHECK (exec_mode IN ('js-inline', 'js-k8s', 'docker')),
    config       JSONB NOT NULL DEFAULT '{}',
    enabled      BOOLEAN NOT NULL DEFAULT true,
    next_run_at  TIMESTAMPTZ,
    last_run_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules (enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules (next_run_at ASC) WHERE enabled = true`,
  `CREATE TABLE IF NOT EXISTS execution_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','timeout')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms  INTEGER,
    output       TEXT DEFAULT '',
    error        TEXT DEFAULT '',
    metadata     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_exec_logs_schedule ON execution_logs (schedule_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_exec_logs_status ON execution_logs (status)`,
  `CREATE INDEX IF NOT EXISTS idx_exec_logs_created ON execution_logs (created_at DESC)`,
];

@Injectable()
export class TenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.setSchema(SCHEMA_SQL);
  }
}
