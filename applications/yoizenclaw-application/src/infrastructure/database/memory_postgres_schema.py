"""PostgreSQL schema initialization SQL.

Provides database schema creation and migration SQL statements
for the memory PostgreSQL backend.
"""

SCHEMA_SQL: dict[str, str] = {
    "enable_pgvector": "CREATE EXTENSION IF NOT EXISTS vector",
    "create_jobs_table": """
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            schedule_type TEXT NOT NULL,
            schedule_config JSONB NOT NULL,
            action_type TEXT NOT NULL,
            action_config JSONB NOT NULL,
            retry_policy JSONB NOT NULL,
            timeout_seconds INTEGER NOT NULL DEFAULT 60,
            tags JSONB,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
            deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
        )
    """,
    "idx_jobs_enabled": """
        CREATE INDEX IF NOT EXISTS idx_jobs_enabled
        ON jobs(enabled)
    """,
    "idx_jobs_tenant_id_id": """
        CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id_id
        ON jobs(tenant_id, id)
    """,
    "create_job_executions_table": """
        CREATE TABLE IF NOT EXISTS job_executions (
            id TEXT PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            job_id TEXT NOT NULL,
            status TEXT NOT NULL,
            triggered_by TEXT NOT NULL,
            event_payload JSONB,
            started_at TIMESTAMP WITH TIME ZONE,
            finished_at TIMESTAMP WITH TIME ZONE,
            result JSONB,
            error_message TEXT,
            logs JSONB,
            retry_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
    """,
    "idx_job_executions_job_id": """
        CREATE INDEX IF NOT EXISTS idx_job_executions_job_id
        ON job_executions(job_id)
    """,
    "idx_job_executions_tenant_id_job_id": """
        CREATE INDEX IF NOT EXISTS idx_job_executions_tenant_id_job_id
        ON job_executions(tenant_id, job_id)
    """,
    "idx_job_executions_status": """
        CREATE INDEX IF NOT EXISTS idx_job_executions_status
        ON job_executions(status)
    """,
    "idx_jobs_schedule_type": """
        CREATE INDEX IF NOT EXISTS idx_jobs_schedule_type
        ON jobs(schedule_type)
    """,
    "idx_jobs_deleted_at": """
        CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at
        ON jobs(deleted_at)
    """,
    "idx_job_executions_started_at": """
        CREATE INDEX IF NOT EXISTS idx_job_executions_started_at
        ON job_executions(started_at DESC)
    """,
    "create_embeddings_table": """
        CREATE TABLE IF NOT EXISTS embeddings (
            id SERIAL PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            content TEXT NOT NULL,
            embedding vector(1536),
            metadata JSONB,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """,
    "idx_embeddings_vector": """
        CREATE INDEX IF NOT EXISTS idx_embeddings_vector
        ON embeddings USING ivfflat (embedding vector_cosine_ops)
    """,
    "idx_embeddings_tenant_id_id": """
        CREATE INDEX IF NOT EXISTS idx_embeddings_tenant_id_id
        ON embeddings(tenant_id, id)
    """,
}

RUNTIME_STATE_SCHEMA_SQL: list[str] = [
    """
        CREATE TABLE IF NOT EXISTS agent_runtime_overrides (
            id TEXT PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            agent_id TEXT NOT NULL,
            config JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
        )
    """,
    """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runtime_overrides_agent_id
        ON agent_runtime_overrides(agent_id)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_agent_runtime_overrides_created_at
        ON agent_runtime_overrides(created_at)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_agent_runtime_overrides_tenant_id_agent_id
        ON agent_runtime_overrides(tenant_id, agent_id)
    """,
    """
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            channel TEXT NOT NULL,
            agent_id TEXT,
            display_name TEXT NOT NULL DEFAULT '',
            config JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
        )
    """,
    """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_channel
        ON channels(channel)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_channels_agent_id
        ON channels(agent_id)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_channels_created_at
        ON channels(created_at)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_channels_tenant_id_channel
        ON channels(tenant_id, channel)
    """,
    """
        CREATE TABLE IF NOT EXISTS config_files (
            id TEXT PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            path TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
        )
    """,
    """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_config_files_path
        ON config_files(path)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_config_files_category
        ON config_files(category)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_config_files_created_at
        ON config_files(created_at)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_config_files_tenant_id_path
        ON config_files(tenant_id, path)
    """,
    """
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            action TEXT NOT NULL,
            subject TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
        )
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_audit_log_scope
        ON audit_log(scope)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
        ON audit_log(created_at)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_audit_log_action
        ON audit_log(action)
    """,
    """
        CREATE INDEX IF NOT EXISTS idx_audit_log_subject
        ON audit_log(subject)
    """,
]

RUNTIME_STATE_ALTER_SQL: list[str] = [
    "ALTER TABLE agent_runtime_overrides ADD COLUMN IF NOT EXISTS id TEXT",
    "ALTER TABLE channels ADD COLUMN IF NOT EXISTS id TEXT",
    "ALTER TABLE channels ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE config_files ADD COLUMN IF NOT EXISTS id TEXT",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS id TEXT",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_by TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL",
    "ALTER TABLE agent_runtime_overrides ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL",
    "ALTER TABLE channels ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL",
    "ALTER TABLE config_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL",
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL",
]
