"""Add tenant_id to all tables for multi-tenant isolation.

Adds tenant_id VARCHAR(64) NOT NULL with DEFAULT '__pending_migration__'
to: runtime_jobs, runtime_job_executions, embeddings,
agent_runtime_overrides, config_files, channels.

Composite indexes on (tenant_id, <key>) optimize tenant-scoped queries.

Revision ID: 002
Revises: 001
Create Date: 2026-03-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES: list[str] = [
    "runtime_jobs",
    "runtime_job_executions",
    "embeddings",
    "agent_runtime_overrides",
    "config_files",
    "channels",
]

_COMPOSITE_INDEXES: list[tuple[str, str, str]] = [
    ("idx_runtime_jobs_tenant_id_id", "runtime_jobs", "tenant_id, id"),
    (
        "idx_runtime_job_executions_tenant_id_job_id",
        "runtime_job_executions",
        "tenant_id, job_id",
    ),
    ("idx_embeddings_tenant_id_id", "embeddings", "tenant_id, id"),
    (
        "idx_agent_runtime_overrides_tenant_id_agent_id",
        "agent_runtime_overrides",
        "tenant_id, agent_id",
    ),
    ("idx_config_files_tenant_id_path", "config_files", "tenant_id, path"),
    ("idx_channels_tenant_id_channel", "channels", "tenant_id, channel"),
]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS tenant_id "
            f"VARCHAR(64) NOT NULL DEFAULT '__pending_migration__'"
        )

    for idx_name, table, columns in _COMPOSITE_INDEXES:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({columns})"
        )


def downgrade() -> None:
    for idx_name, table, _columns in _COMPOSITE_INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {idx_name}")

    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} DROP COLUMN IF EXISTS tenant_id"
        )
