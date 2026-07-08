import type { Sql } from "@yoizen/database";

const SKB_TABLES_DDL = `
  -- SKB (Structured Knowledge Base) tables — Phase 1

  CREATE TABLE IF NOT EXISTS skb_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','processing','ready','failed')),
    version VARCHAR(64) NOT NULL DEFAULT 'v1',
    ingest_model VARCHAR(128) DEFAULT 'gpt-4.1-mini',
    query_model VARCHAR(128) DEFAULT 'gpt-4.1-mini',
    provider_config JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, id, version)
  );

  CREATE INDEX IF NOT EXISTS idx_skb_containers_tenant
    ON skb_containers(tenant_id, is_active);

  CREATE TABLE IF NOT EXISTS skb_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    file_id VARCHAR(255) NOT NULL,
    original_name VARCHAR(512) NOT NULL,
    detected_encoding VARCHAR(32),
    categories JSONB DEFAULT '[]'::jsonb,
    row_count INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','processing','completed','failed')),
    error_message TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (container_id, file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_skb_files_container
    ON skb_files(container_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_skb_files_categories
    ON skb_files USING gin (categories);

  CREATE TABLE IF NOT EXISTS skb_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES skb_files(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    table_description TEXT,
    query_rules TEXT,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    row_count INTEGER DEFAULT 0,
    analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_skb_schemas_container
    ON skb_schemas(container_id);

  CREATE TABLE IF NOT EXISTS skb_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id UUID NOT NULL REFERENCES skb_containers(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES skb_files(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    file_index INTEGER,
    categories JSONB DEFAULT '[]'::jsonb,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    data_tsv TSVECTOR GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(data::text, ''))
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Idempotent for tenants whose skb_rows predates the file_index column
  -- (SKBRowsRepository.insertRows/getRows use it to preserve source-file order).
  ALTER TABLE skb_rows ADD COLUMN IF NOT EXISTS file_index INTEGER;

  CREATE INDEX IF NOT EXISTS idx_skb_rows_container
    ON skb_rows(container_id);
  CREATE INDEX IF NOT EXISTS idx_skb_rows_file
    ON skb_rows(file_id);
  CREATE INDEX IF NOT EXISTS idx_skb_rows_categories
    ON skb_rows USING gin (categories);
  CREATE INDEX IF NOT EXISTS idx_skb_rows_tsv
    ON skb_rows USING gin (data_tsv);

  -- Dynamic functional indexes for high-cardinality numeric columns
  CREATE INDEX IF NOT EXISTS idx_skb_rows_data_gin
    ON skb_rows USING gin (data jsonb_path_ops);
  CREATE INDEX IF NOT EXISTS idx_skb_rows_container_tenant
    ON skb_rows(container_id, tenant_id);

  -- Tenants provisioned before 2026-07-07 carry an incompatible legacy
  -- skb_query_history shape (natural_query/sql_where/executed_at). Nothing
  -- ever wrote to it (the history path was wired 2026-07-07), so the legacy
  -- table is empty everywhere and can be dropped and recreated safely.
  -- Postgres resolves index column references at parse-analysis time even
  -- for CREATE INDEX IF NOT EXISTS, so the legacy shape must be gone before
  -- the index statement below is parsed against it.
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'skb_query_history' AND column_name = 'executed_at'
    ) THEN
      DROP TABLE skb_query_history;
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS skb_query_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id UUID NOT NULL REFERENCES skb_containers(id),
    tenant_id VARCHAR(255) NOT NULL,
    nl_query TEXT NOT NULL,
    generated_sql TEXT,
    result_count INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    error TEXT,
    error_message TEXT,
    user_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Attribution ids (metering-foundation.md G5) -- nullable; today's only
  -- caller is the admin API (StructuredKBController.query), which has none
  -- of these, but SKBQueryService.query() accepts and threads them so a
  -- future agent-tool caller with real execution context can populate them.
  -- Must precede the index below (Postgres resolves CREATE INDEX column
  -- references at parse-analysis time, even with IF NOT EXISTS).
  ALTER TABLE skb_query_history ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);
  ALTER TABLE skb_query_history ADD COLUMN IF NOT EXISTS causation_id VARCHAR(255);
  ALTER TABLE skb_query_history ADD COLUMN IF NOT EXISTS execution_id VARCHAR(255);

  CREATE INDEX IF NOT EXISTS idx_skb_query_history_container
    ON skb_query_history(container_id, created_at DESC);
`;

const AGENT_ADMIN_SCHEMA_DDL = `
        CREATE TABLE IF NOT EXISTS agents (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          system_prompt TEXT NOT NULL,
          model_config JSONB NOT NULL DEFAULT '{}',
          tools JSONB DEFAULT '[]',
          enabled_tools JSONB DEFAULT NULL,
          channels JSONB DEFAULT '[]',
          knowledge_base_ids JSONB DEFAULT '[]'::jsonb,
          input_variables JSONB DEFAULT '[]'::jsonb,
          output_variables JSONB DEFAULT '[]'::jsonb,
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

        CREATE TABLE IF NOT EXISTS skills (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT DEFAULT '',
          system_prompt TEXT NOT NULL,
          icon VARCHAR(50) DEFAULT 'smart_toy',
          color VARCHAR(7) DEFAULT '#42a5f5',
          trigger_commands TEXT[] DEFAULT '{}',
          metadata JSONB DEFAULT '{}'::jsonb,
          files JSONB DEFAULT '[]'::jsonb,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_skills_tenant ON skills(tenant_id);

        CREATE TABLE IF NOT EXISTS mcp_servers (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          transport_type VARCHAR(10) NOT NULL CHECK (transport_type IN ('http', 'sse')),
          url TEXT NOT NULL,
          headers JSONB DEFAULT '{}'::jsonb,
          auth_type VARCHAR(20) NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'api-key', 'bearer', 'basic')),
          auth_config JSONB DEFAULT NULL,
          enabled BOOLEAN DEFAULT true,
          is_active BOOLEAN DEFAULT true,
          managed_by VARCHAR(255) DEFAULT NULL,
          managed_locked_fields JSONB DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON mcp_servers(tenant_id);

        CREATE TABLE IF NOT EXISTS system_variables (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL,
          value JSONB NOT NULL DEFAULT 'null'::jsonb,
          label VARCHAR(255),
          description TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_system_vars_tenant_name ON system_variables(tenant_id, name);

        CREATE EXTENSION IF NOT EXISTS vector;

        CREATE TABLE IF NOT EXISTS knowledge_bases (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          project VARCHAR(255),
          category VARCHAR(255),
          icon VARCHAR(64) DEFAULT 'library_books',
          ingestion_config JSONB DEFAULT '{}'::jsonb,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_bases(tenant_id, is_active);

        CREATE TABLE IF NOT EXISTS documents (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id),
          original_filename VARCHAR(512) NOT NULL,
          mime_type VARCHAR(128) NOT NULL,
          content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('text', 'markdown', 'pdf', 'csv', 'html', 'docx')),
          content_text TEXT,
          file_size INTEGER NOT NULL DEFAULT 0,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
          error_message TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_docs_kb ON documents(knowledge_base_id, is_active);

        -- Partial index for the ingestion watchdog: finds stuck 'processing' docs efficiently.
        CREATE INDEX IF NOT EXISTS idx_docs_stuck_processing ON documents(status, updated_at) WHERE status = 'processing';

        CREATE TABLE IF NOT EXISTS document_chunks (
          id UUID PRIMARY KEY,
          tenant_id VARCHAR(255) NOT NULL,
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          is_edited BOOLEAN DEFAULT FALSE,
          edited_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_kb ON document_chunks(knowledge_base_id);
        CREATE INDEX IF NOT EXISTS idx_doc_chunks_edited ON document_chunks(is_edited) WHERE is_edited = TRUE;

        CREATE TABLE IF NOT EXISTS document_chunks_embedding (
          chunk_id UUID PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
          embedding vector(1536) NOT NULL,
          model VARCHAR(255)
        );
      `;

/**
 * Incremental migrations that run on every init (idempotent via IF NOT EXISTS).
 * These handle columns added after the initial schema creation.
 */
const AGENT_ADMIN_MIGRATIONS = `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS enabled_tools JSONB DEFAULT NULL;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS enabled_mcp_servers JSONB DEFAULT NULL;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS enabled_mcp_tools JSONB DEFAULT NULL;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS tool_description_overrides JSONB DEFAULT NULL;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_base_ids JSONB DEFAULT '[]'::jsonb;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS input_variables JSONB DEFAULT '[]'::jsonb;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS output_variables JSONB DEFAULT '[]'::jsonb;
  -- Convert knowledge_base_ids from text[] to JSONB if needed
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'agents'
        AND column_name = 'knowledge_base_ids'
        AND data_type = 'ARRAY'
    ) THEN
      ALTER TABLE agents ALTER COLUMN knowledge_base_ids TYPE JSONB USING
        CASE
          WHEN knowledge_base_ids IS NULL THEN '[]'::jsonb
          WHEN knowledge_base_ids::text = '{}' THEN '[]'::jsonb
          ELSE to_jsonb(knowledge_base_ids::text[])
        END;
    END IF;
  END$$;
  -- Ensure input_variables and output_variables are JSONB
  ALTER TABLE agents ALTER COLUMN input_variables TYPE JSONB USING
    CASE
      WHEN input_variables IS NULL THEN '[]'::jsonb
      WHEN input_variables::text = '{}' THEN '[]'::jsonb
      ELSE input_variables::text::jsonb
    END;
  ALTER TABLE agents ALTER COLUMN output_variables TYPE JSONB USING
    CASE
      WHEN output_variables IS NULL THEN '[]'::jsonb
      WHEN output_variables::text = '{}' THEN '[]'::jsonb
      ELSE output_variables::text::jsonb
    END;
  ALTER TABLE skills ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::jsonb;
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS knowledge_bases (id UUID PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL, description TEXT, project VARCHAR(255), category VARCHAR(255), icon VARCHAR(64) DEFAULT 'library_books', is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_bases(tenant_id, is_active);
  CREATE TABLE IF NOT EXISTS documents (id UUID PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id), original_filename VARCHAR(512) NOT NULL, mime_type VARCHAR(128) NOT NULL, content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('text', 'markdown', 'pdf', 'csv', 'html', 'docx')), content_text TEXT, file_size INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')), error_message TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS idx_docs_kb ON documents(knowledge_base_id, is_active);
  CREATE TABLE IF NOT EXISTS document_chunks (id UUID PRIMARY KEY, tenant_id VARCHAR(255) NOT NULL, document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE, knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS idx_chunks_kb ON document_chunks(knowledge_base_id);
  CREATE TABLE IF NOT EXISTS document_chunks_embedding (chunk_id UUID PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE, embedding vector(1536) NOT NULL);
  ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS ingestion_config JSONB DEFAULT '{}'::jsonb;
  CREATE INDEX IF NOT EXISTS idx_docs_stuck_processing ON documents(status, updated_at) WHERE status = 'processing';
  ALTER TABLE skills ADD COLUMN IF NOT EXISTS when_to_use TEXT DEFAULT '';
  ALTER TABLE skills ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
  ALTER TABLE skills ADD COLUMN IF NOT EXISTS allowed_tools TEXT[] DEFAULT '{}';
  ALTER TABLE skills ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'llm_driven';
  ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
  ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS idx_doc_chunks_edited ON document_chunks(is_edited) WHERE is_edited = TRUE;
  -- Deduplicate leftover chunks from before idempotent ingestion fix
  DELETE FROM document_chunks a USING document_chunks b
  WHERE a.document_id = b.document_id
    AND a.chunk_index = b.chunk_index
    AND a.tenant_id = b.tenant_id
    AND a.created_at < b.created_at;
  -- Prevent future duplicate chunks per document
  CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_doc_chunk_unique ON document_chunks(document_id, chunk_index);
  -- Track which embedding model was used per chunk
  ALTER TABLE document_chunks_embedding ADD COLUMN IF NOT EXISTS model VARCHAR(255);
  -- Allow docx content type in documents (added post-deployment to support DOCX uploads)
  ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_content_type_check;
  ALTER TABLE documents ADD CONSTRAINT documents_content_type_check CHECK (content_type IN ('text', 'markdown', 'pdf', 'csv', 'html', 'docx'));
  -- Draft/Published versioning: stores the last published snapshot
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS published_config JSONB;

  -- Agent version history: full audit trail of every published snapshot
  CREATE TABLE IF NOT EXISTS agent_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_id ON agent_versions(agent_id, version_number DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_versions_agent_version ON agent_versions(agent_id, version_number);

  -- SemVer + published_by for agent versions
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS semver_major INTEGER;
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS semver_minor INTEGER;
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS semver_patch INTEGER;
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS semver_label VARCHAR(20);
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS bump_type VARCHAR(10);
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS diff JSONB;
  ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS published_by VARCHAR(255);
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS published_by VARCHAR(255);

  -- MCP server auth + managed/sync fields (mcp-connections.md §2.1, §2.3)
  ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS auth_type VARCHAR(20) NOT NULL DEFAULT 'none';
  ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_auth_type_check;
  ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_auth_type_check CHECK (auth_type IN ('none', 'api-key', 'bearer', 'basic'));
  ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS auth_config JSONB DEFAULT NULL;
  ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS managed_by VARCHAR(255) DEFAULT NULL;
  ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS managed_locked_fields JSONB DEFAULT NULL;

  -- MCP call usage logging (mcp-connections.md §3). Lives in the same
  -- per-tenant database as mcp_servers -- unlike connector call usage
  -- (connector_call_events, a shared cross-tenant TimescaleDB table owned
  -- exclusively by usage-aggregator-service), MCP usage is written directly
  -- by the producing services (agent-ai-service today, connector-runtime's
  -- planned mcp-call.activity.ts later) via agent-admin-service's own
  -- POST admin/mcp-servers/usage-events, so it belongs in agent-admin-service's
  -- existing per-tenant schema rather than standing up a new NATS + aggregator
  -- pipeline for what is, for now, a much lower-volume call path.
  CREATE TABLE IF NOT EXISTS mcp_call_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    mcp_server_id UUID REFERENCES mcp_servers(id) ON DELETE SET NULL,
    server_name VARCHAR(255) NOT NULL,
    tool_name VARCHAR(255) NOT NULL,
    success BOOLEAN NOT NULL,
    duration_ms INTEGER NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Attribution ids (metering-foundation.md G5) -- nullable, threaded from
  -- producers on a best-effort basis (tool-bridge.service.ts's chat path has
  -- a conversationId/executionId; connector-runtime's Temporal mcpCall
  -- activity only ever has workflow-level correlation/causation). ALTERs
  -- must precede the index below that references execution_id -- Postgres
  -- resolves index column references at parse-analysis time even for
  -- CREATE INDEX IF NOT EXISTS (see the skb_query_history note below for the
  -- same gotcha in this same DDL file).
  ALTER TABLE mcp_call_events ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);
  ALTER TABLE mcp_call_events ADD COLUMN IF NOT EXISTS causation_id VARCHAR(255);
  ALTER TABLE mcp_call_events ADD COLUMN IF NOT EXISTS execution_id VARCHAR(255);

  CREATE INDEX IF NOT EXISTS idx_mcp_call_events_tenant_server_created
    ON mcp_call_events(tenant_id, mcp_server_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_mcp_call_events_execution
    ON mcp_call_events(execution_id) WHERE execution_id IS NOT NULL;
`;

/**
 * Agent admin DDL executed once per tenant inside a transaction.
 */
export async function initAgentAdminTenantSchema(
  _tenantId: string,
  sql: Sql
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET client_min_messages TO WARNING`);
    await tx.unsafe(AGENT_ADMIN_SCHEMA_DDL);
    await tx.unsafe(AGENT_ADMIN_MIGRATIONS);
    await tx.unsafe(SKB_TABLES_DDL);
    await tx.unsafe(`RESET client_min_messages`);
  });
}
