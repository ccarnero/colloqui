import {
  Injectable,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import postgres from "postgres";
import { requireEnv } from "@yoizen/database";

export type Sql = ReturnType<typeof postgres>;

const PG_DATABASE = "yoizen";

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly initializedSchemas = new Set<string>();
  private readonly pendingInits = new Map<string, Promise<void>>();

  private readonly port = Number(process.env.POSTGRES_PORT) || 5432;
  private readonly username = process.env.POSTGRES_USER ?? "yoizen";
  private readonly password = requireEnv("POSTGRES_PASSWORD");
  private readonly env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

  getConnection(tenantId: string): Sql {
    const existing = this.pools.get(tenantId);
    if (existing) return existing;

    const host = `postgres.${tenantId}-${this.env}-ns.svc.cluster.local`;
    const pool = postgres({
      host,
      port: this.port,
      database: PG_DATABASE,
      username: this.username,
      password: this.password,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 30,
      onnotice: () => {},
    });
    this.pools.set(tenantId, pool);
    this.logger.log(
      `Created connection pool for tenant '${tenantId}' -> ${host}/${PG_DATABASE}`,
    );
    return pool;
  }

  getKnownTenantIds(): string[] {
    return Array.from(this.pools.keys());
  }

  isSchemaInitialized(tenantId: string): boolean {
    return this.initializedSchemas.has(tenantId);
  }

  markSchemaInitialized(tenantId: string): void {
    this.initializedSchemas.add(tenantId);
  }

  /**
   * Lazily initialises the tenant schema. Uses promise dedup to
   * prevent concurrent duplicate DDL runs for the same tenant.
   */
  async ensureSchema(tenantId: string): Promise<void> {
    if (this.isSchemaInitialized(tenantId)) return;

    const pending = this.pendingInits.get(tenantId);
    if (pending) return pending;

    const promise = this.initSchema(tenantId);
    this.pendingInits.set(tenantId, promise);
    try {
      await promise;
    } finally {
      this.pendingInits.delete(tenantId);
    }
  }

  private async initSchema(tenantId: string): Promise<void> {
    const sql = this.getConnection(tenantId);

    await sql.begin(async (tx) => {
      await tx.unsafe(`SET client_min_messages TO WARNING`);
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS agents (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          system_prompt TEXT NOT NULL,
          model_config JSONB NOT NULL DEFAULT '{}',
          tools JSONB DEFAULT '[]',
          channels JSONB DEFAULT '[]',
          status VARCHAR(50) DEFAULT 'draft',
          is_active BOOLEAN DEFAULT true,
          published_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
        CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);

        CREATE TABLE IF NOT EXISTS credentials (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          provider VARCHAR(50) NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'google-vertex', 'bedrock', 'groq', 'mistral', 'openrouter', 'xai', 'cohere', 'cerebras', 'huggingface', 'mock')),
          schema_version INTEGER NOT NULL DEFAULT 1,
          payload JSONB NOT NULL DEFAULT '{}',
          sync_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed', 'manual_review_required')),
          last_sync_at TIMESTAMPTZ,
          sync_error TEXT,
          is_encrypted BOOLEAN DEFAULT false,
          metadata JSONB DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Idempotent migration for existing tenant schemas
        -- Add new provider-aware columns if they don't exist
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS provider VARCHAR(50) CHECK (provider IN ('openai', 'anthropic', 'google', 'google-vertex', 'bedrock', 'groq', 'mistral', 'openrouter', 'xai', 'cohere', 'cerebras', 'huggingface', 'mock'));
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed', 'manual_review_required'));
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS sync_error TEXT;
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false;
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
        ALTER TABLE IF EXISTS credentials ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

        -- Remove legacy columns from existing tables (no-op if they don't exist)
        ALTER TABLE IF EXISTS credentials DROP COLUMN IF EXISTS type;
        ALTER TABLE IF EXISTS credentials DROP COLUMN IF EXISTS config;
        ALTER TABLE IF EXISTS credentials DROP COLUMN IF EXISTS value;

        -- Index for sync status queries
        CREATE INDEX IF NOT EXISTS idx_credentials_sync_status ON credentials(sync_status) WHERE is_active = true;
        CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider) WHERE is_active = true;

        CREATE TABLE IF NOT EXISTS jobs (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          agent_id UUID NOT NULL REFERENCES agents(id),
          schedule VARCHAR(255) NOT NULL,
          payload JSONB DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          last_run TIMESTAMPTZ,
          next_run TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_agent_id ON jobs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active) WHERE is_active = true;

        CREATE TABLE IF NOT EXISTS job_executions (
          id UUID PRIMARY KEY,
          job_id UUID NOT NULL REFERENCES jobs(id),
          status VARCHAR(50) NOT NULL,
          event_payload JSONB DEFAULT '{}',
          result JSONB,
          logs TEXT[],
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          triggered_by VARCHAR(50),
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS config_files (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          path TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL,
          format VARCHAR(10) NOT NULL CHECK (format IN ('yaml', 'json')),
          version INTEGER DEFAULT 1,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await tx.unsafe(`RESET client_min_messages`);
    });

    this.markSchemaInitialized(tenantId);
    this.logger.log(`Schema initialized for tenant '${tenantId}'`);
  }

  async verifyConnectivity(): Promise<boolean> {
    if (this.pools.size === 0) return true;
    for (const sql of this.pools.values()) {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      tasks.push(pool.end());
    }
    await Promise.all(tasks);
    this.pools.clear();
    this.initializedSchemas.clear();
  }
}
