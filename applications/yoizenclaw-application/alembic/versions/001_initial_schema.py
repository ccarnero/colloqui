"""Initial schema — baseline for existing tables.

Captures all tables from memory_postgres_schema.py as the starting
point. Since tables may already exist in dev databases, the upgrade
uses raw DDL with IF NOT EXISTS guards via op.execute().

Revision ID: 001
Revises: None
Create Date: 2026-03-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
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
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_jobs_enabled
        ON jobs(enabled)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_jobs_schedule_type
        ON jobs(schedule_type)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS job_executions (
            id TEXT PRIMARY KEY,
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
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_job_executions_job_id
        ON job_executions(job_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_job_executions_status
        ON job_executions(status)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_job_executions_started_at
        ON job_executions(started_at DESC)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            embedding vector(1536),
            metadata JSONB,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_embeddings_vector
        ON embeddings USING ivfflat (embedding vector_cosine_ops)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS agent_runtime_overrides (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            config JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runtime_overrides_agent_id
        ON agent_runtime_overrides(agent_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_runtime_overrides_created_at
        ON agent_runtime_overrides(created_at)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            agent_id TEXT,
            display_name TEXT NOT NULL DEFAULT '',
            config JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_channel
        ON channels(channel)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_channels_agent_id
        ON channels(agent_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_channels_created_at
        ON channels(created_at)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS config_files (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_config_files_path
        ON config_files(path)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_config_files_category
        ON config_files(category)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_config_files_created_at
        ON config_files(created_at)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            action TEXT NOT NULL,
            subject TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_scope
        ON audit_log(scope)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
        ON audit_log(created_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_action
        ON audit_log(action)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_log_subject
        ON audit_log(subject)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP TABLE IF EXISTS config_files")
    op.execute("DROP TABLE IF EXISTS channels")
    op.execute("DROP TABLE IF EXISTS agent_runtime_overrides")
    op.execute("DROP TABLE IF EXISTS embeddings")
    op.execute("DROP TABLE IF EXISTS job_executions")
    op.execute("DROP TABLE IF EXISTS jobs")
    op.execute("DROP EXTENSION IF EXISTS vector")
