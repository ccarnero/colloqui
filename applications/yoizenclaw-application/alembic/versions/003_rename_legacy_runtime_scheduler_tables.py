"""Rename legacy Python scheduler tables away from public.jobs collision.

yoizenclaw-admin-service owns ``jobs`` / ``job_executions`` (UUID, agent_id).
The application runtime uses TEXT ids — tables are ``runtime_jobs`` /
``runtime_job_executions``. This revision is idempotent for DBs that still
have the old names from pre-rename Alembic or runtime DDL.

Revision ID: 003
Revises: 002
Create Date: 2026-04-15
"""

from typing import Sequence, Union

from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_RENAME_UP_SQL: str = """
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'jobs'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs'
      AND column_name = 'agent_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runtime_jobs'
  )
  THEN
    ALTER TABLE jobs RENAME TO runtime_jobs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'job_executions'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runtime_job_executions'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'job_executions'
      AND c.column_name = 'job_id'
      AND c.data_type IN ('text', 'character varying')
  )
  THEN
    ALTER TABLE job_executions RENAME TO runtime_job_executions;
  END IF;
END
$migration$;
"""

_LEGACY_RENAME_DOWN_SQL: str = """
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runtime_jobs'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'runtime_jobs'
      AND column_name = 'agent_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'jobs'
  )
  THEN
    ALTER TABLE runtime_jobs RENAME TO jobs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'runtime_job_executions'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'job_executions'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'runtime_job_executions'
      AND c.column_name = 'job_id'
      AND c.data_type IN ('text', 'character varying')
  )
  THEN
    ALTER TABLE runtime_job_executions RENAME TO job_executions;
  END IF;
END
$migration$;
"""


def upgrade() -> None:
    op.execute(_LEGACY_RENAME_UP_SQL)


def downgrade() -> None:
    op.execute(_LEGACY_RENAME_DOWN_SQL)
