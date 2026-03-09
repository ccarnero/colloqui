import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

const PG_DATABASE = 'yoizen';

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly initialized = new Set<string>();

  private readonly port = Number(process.env.POSTGRES_PORT) || 5432;
  private readonly username = process.env.POSTGRES_USER ?? 'yoizen';
  private readonly password = process.env.POSTGRES_PASSWORD ?? 'yoizen-dev-password';
  private readonly env = process.env.PLATFORM_ENVIRONMENT ?? 'dev';

  getConnection(tenantId: string): Sql {
    let pool = this.pools.get(tenantId);
    if (pool) return pool;

    const host = `postgres.${tenantId}-${this.env}-ns.svc.cluster.local`;
    pool = postgres({
      host,
      port: this.port,
      database: PG_DATABASE,
      username: this.username,
      password: this.password,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 30,
    });
    this.pools.set(tenantId, pool);
    this.logger.log(`Created connection pool for tenant '${tenantId}' -> ${host}/${PG_DATABASE}`);
    return pool;
  }

  async ensureSchema(tenantId: string): Promise<Sql> {
    const sql = this.getConnection(tenantId);
    if (this.initialized.has(tenantId)) return sql;

    await sql`
      CREATE TABLE IF NOT EXISTS schedules (
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
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules (enabled)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules (next_run_at ASC) WHERE enabled = true`;

    await sql`
      CREATE TABLE IF NOT EXISTS execution_logs (
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
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_exec_logs_schedule ON execution_logs (schedule_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_exec_logs_status ON execution_logs (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_exec_logs_created ON execution_logs (created_at DESC)`;

    this.initialized.add(tenantId);
    return sql;
  }

  getKnownTenantIds(): string[] {
    return Array.from(this.pools.keys());
  }

  async onModuleDestroy(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      tasks.push(pool.end());
    }
    await Promise.all(tasks);
    this.pools.clear();
    this.initialized.clear();
  }
}
