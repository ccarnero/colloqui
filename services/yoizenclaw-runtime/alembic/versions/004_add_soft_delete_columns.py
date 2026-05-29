"""Add deleted_at columns for soft-delete queries.

Aligns runtime Postgres schema with memory_postgres_schema.py /
memory_postgres_jobs.py (tenant-scoped queries filter deleted_at IS NULL).

Revision ID: 004
Revises: 003
Create Date: 2026-05-27
"""

from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES_WITH_SOFT_DELETE: tuple[str, ...] = (
    "runtime_jobs",
    "agent_runtime_overrides",
    "channels",
    "config_files",
    "audit_log",
)


def upgrade() -> None:
    for table in _TABLES_WITH_SOFT_DELETE:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
            f"deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL"
        )

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_runtime_jobs_deleted_at "
        "ON runtime_jobs(deleted_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_runtime_jobs_deleted_at")

    for table in _TABLES_WITH_SOFT_DELETE:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS deleted_at")
