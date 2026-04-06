import type { Sql } from "@yoizen/database";

const YOIZENCLAW_ADMIN_SCHEMA_DDL = `
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
          type VARCHAR(50) NOT NULL CHECK (type IN ('api_key', 'oauth', 'basic', 'custom')),
          value TEXT NOT NULL,
          is_encrypted BOOLEAN DEFAULT false,
          metadata JSONB DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

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
      `;

/**
 * YoizenClaw admin DDL executed once per tenant inside a transaction.
 */
export async function initYoizenClawTenantSchema(
  _tenantId: string,
  sql: Sql,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET client_min_messages TO WARNING`);
    await tx.unsafe(YOIZENCLAW_ADMIN_SCHEMA_DDL);
    await tx.unsafe(`RESET client_min_messages`);
  });
}
