"""Tests for tenant_id database migration (Phase 1.1).

Task 1.1.1 [RED]: Verify migration 002_add_tenant_id creates tenant_id
columns with NOT NULL constraints and composite indexes.

Task 1.1.3 [REFACTOR]: Verify composite indexes optimize tenant-scoped
queries by placing tenant_id as the leading column.
"""

from __future__ import annotations

import importlib
import sys
import types
from typing import Generator

import pytest


TENANT_TABLES: list[str] = [
    "agent_runtime_overrides",
    "config_files",
    "channels",
    "jobs",
    "job_executions",
    "embeddings",
]

EXPECTED_COMPOSITE_INDEXES: dict[str, tuple[str, str]] = {
    "agent_runtime_overrides": ("tenant_id", "agent_id"),
    "config_files": ("tenant_id", "path"),
    "channels": ("tenant_id", "channel"),
    "jobs": ("tenant_id", "id"),
    "job_executions": ("tenant_id", "job_id"),
    "embeddings": ("tenant_id", "id"),
}

MIGRATION_MODULE = "alembic.versions.002_add_tenant_id"


def _install_mocks(
    captured: list[str],
) -> dict[str, types.ModuleType | None]:
    """Inject mock alembic.op and sqlalchemy into sys.modules.

    Returns originals dict for cleanup via _remove_mocks().
    """
    originals: dict[str, types.ModuleType | None] = {}

    originals["alembic.op"] = sys.modules.get("alembic.op")
    mock_op = types.ModuleType("alembic.op")
    mock_op.execute = lambda sql: captured.append(sql.strip())  # type: ignore[attr-defined]
    sys.modules["alembic.op"] = mock_op

    originals["sqlalchemy"] = sys.modules.get("sqlalchemy")
    mock_sa = types.ModuleType("sqlalchemy")
    sys.modules["sqlalchemy"] = mock_sa

    return originals


def _remove_mocks(originals: dict[str, types.ModuleType | None]) -> None:
    """Restore sys.modules after mock injection."""
    for name, orig in originals.items():
        if orig is not None:
            sys.modules[name] = orig
        else:
            sys.modules.pop(name, None)


@pytest.fixture()
def _captured_sql() -> Generator[tuple[list[str], dict[str, types.ModuleType | None]], None, None]:
    captured: list[str] = []
    originals = _install_mocks(captured)
    yield captured, originals
    _remove_mocks(originals)


def _import_migration() -> types.ModuleType:
    sys.modules.pop(MIGRATION_MODULE, None)
    return importlib.import_module(MIGRATION_MODULE)


class TestMigration002Exists:
    def test_migration_module_imports(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> None:
        migration = _import_migration()
        assert callable(getattr(migration, "upgrade", None))
        assert callable(getattr(migration, "downgrade", None))

    def test_revision_is_002(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> None:
        migration = _import_migration()
        assert migration.revision == "002"  # type: ignore[union-attr]

    def test_depends_on_001(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> None:
        migration = _import_migration()
        assert migration.down_revision == "001"  # type: ignore[union-attr]


class TestUpgradeAddsTenantIdColumns:
    @pytest.fixture(autouse=True)
    def _run_upgrade(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> Generator[None, None, None]:
        self.captured = _captured_sql[0]  # type: ignore[attr-defined]
        migration = _import_migration()
        migration.upgrade()
        yield

    def test_adds_tenant_id_varchar_to_all_tables(self) -> None:
        for table in TENANT_TABLES:
            found = any(
                f"ALTER TABLE {table}" in stmt
                and "tenant_id" in stmt
                and "VARCHAR" in stmt.upper()
                for stmt in self.captured
            )
            assert found, f"Missing ALTER TABLE {table} ADD tenant_id"

    def test_tenant_id_is_varchar_64(self) -> None:
        for table in TENANT_TABLES:
            found = any(
                f"ALTER TABLE {table}" in stmt
                and "tenant_id" in stmt
                and "64" in stmt
                for stmt in self.captured
            )
            assert found, f"tenant_id on {table} must be VARCHAR(64)"

    def test_tenant_id_is_not_null(self) -> None:
        for table in TENANT_TABLES:
            found = any(
                f"ALTER TABLE {table}" in stmt
                and "tenant_id" in stmt
                and "NOT NULL" in stmt.upper()
                for stmt in self.captured
            )
            assert found, f"tenant_id on {table} must be NOT NULL"

    def test_tenant_id_has_default_for_existing_data(self) -> None:
        for table in TENANT_TABLES:
            found = any(
                f"ALTER TABLE {table}" in stmt
                and "tenant_id" in stmt
                and "DEFAULT" in stmt.upper()
                for stmt in self.captured
            )
            assert found, f"tenant_id on {table} needs DEFAULT for migration"


class TestUpgradeCreatesCompositeIndexes:
    @pytest.fixture(autouse=True)
    def _run_upgrade(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> Generator[None, None, None]:
        self.captured = _captured_sql[0]  # type: ignore[attr-defined]
        migration = _import_migration()
        migration.upgrade()
        yield

    def test_composite_indexes_cover_all_tables(self) -> None:
        for table, (col1, col2) in EXPECTED_COMPOSITE_INDEXES.items():
            found = any(
                "CREATE" in stmt.upper()
                and "INDEX" in stmt.upper()
                and table in stmt
                and col1 in stmt
                and col2 in stmt
                for stmt in self.captured
            )
            assert found, (
                f"Missing composite index on {table}({col1}, {col2})"
            )


class TestDowngradeRemovesTenantId:
    @pytest.fixture(autouse=True)
    def _run_downgrade(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> Generator[None, None, None]:
        self.captured = _captured_sql[0]  # type: ignore[attr-defined]
        migration = _import_migration()
        migration.downgrade()
        yield

    def test_drops_tenant_id_from_all_tables(self) -> None:
        for table in TENANT_TABLES:
            found = any(
                f"ALTER TABLE {table}" in stmt
                and "DROP" in stmt.upper()
                and "tenant_id" in stmt
                for stmt in self.captured
            )
            assert found, f"Downgrade must DROP tenant_id from {table}"

    def test_drops_composite_indexes(self) -> None:
        for table in TENANT_TABLES:
            found = any(
                "DROP" in stmt.upper()
                and "INDEX" in stmt.upper()
                and "tenant_id" in stmt
                and table in stmt
                for stmt in self.captured
            )
            assert found, (
                f"Downgrade must DROP INDEX with tenant_id on {table}"
            )


class TestSchemaSqlIncludesTenantId:
    def test_jobs_table_has_tenant_id(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import SCHEMA_SQL

        sql = SCHEMA_SQL["create_jobs_table"]
        assert "tenant_id" in sql, "jobs table must include tenant_id"
        assert "NOT NULL" in sql

    def test_job_executions_table_has_tenant_id(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import SCHEMA_SQL

        sql = SCHEMA_SQL["create_job_executions_table"]
        assert "tenant_id" in sql
        assert "NOT NULL" in sql

    def test_embeddings_table_has_tenant_id(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import SCHEMA_SQL

        sql = SCHEMA_SQL["create_embeddings_table"]
        assert "tenant_id" in sql
        assert "NOT NULL" in sql

    def test_agent_runtime_overrides_has_tenant_id(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import (
            RUNTIME_STATE_SCHEMA_SQL,
        )

        sql = RUNTIME_STATE_SCHEMA_SQL[0]
        assert "CREATE TABLE" in sql
        assert "agent_runtime_overrides" in sql
        assert "tenant_id" in sql
        assert "NOT NULL" in sql

    def test_channels_has_tenant_id(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import (
            RUNTIME_STATE_SCHEMA_SQL,
        )

        channels_sql = next(
            s
            for s in RUNTIME_STATE_SCHEMA_SQL
            if "CREATE TABLE" in s and "channels" in s
        )
        assert "tenant_id" in channels_sql
        assert "NOT NULL" in channels_sql

    def test_config_files_has_tenant_id(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import (
            RUNTIME_STATE_SCHEMA_SQL,
        )

        config_sql = next(
            s
            for s in RUNTIME_STATE_SCHEMA_SQL
            if "CREATE TABLE" in s and "config_files" in s
        )
        assert "tenant_id" in config_sql
        assert "NOT NULL" in config_sql


class TestCompositeIndexOptimization:
    """Verify composite indexes place tenant_id first for optimal scans.

    In a composite index (a, b), PostgreSQL can use index-only scans for
    queries filtering by 'a' alone or by 'a AND b', but NOT for queries
    filtering by 'b' alone. Since every tenant-scoped query filters by
    tenant_id first, it MUST be the leading column.
    """

    @pytest.fixture(autouse=True)
    def _run_upgrade(
        self, _captured_sql: tuple[list[str], dict[str, types.ModuleType | None]]
    ) -> Generator[None, None, None]:
        self.captured = _captured_sql[0]  # type: ignore[attr-defined]
        migration = _import_migration()
        migration.upgrade()
        yield

    def test_tenant_id_is_leading_column_in_all_indexes(self) -> None:
        for table in TENANT_TABLES:
            index_stmts = [
                stmt
                for stmt in self.captured
                if "CREATE" in stmt.upper()
                and "INDEX" in stmt.upper()
                and table in stmt
                and "tenant_id" in stmt
            ]
            assert len(index_stmts) >= 1, (
                f"No composite index found for {table}"
            )
            for stmt in index_stmts:
                paren_content = stmt.split("(", 1)[-1].split(")", 1)[0]
                columns = [c.strip() for c in paren_content.split(",")]
                assert columns[0] == "tenant_id", (
                    f"Index on {table} has tenant_id at position "
                    f"{columns.index('tenant_id') + 1}, expected 1. "
                    f"Columns: {columns}"
                )

    def test_indexes_cover_primary_query_patterns(self) -> None:
        for table, expected_cols in EXPECTED_COMPOSITE_INDEXES.items():
            found = any(
                "CREATE" in stmt.upper()
                and "INDEX" in stmt.upper()
                and table in stmt
                and expected_cols[0] in stmt
                and expected_cols[1] in stmt
                for stmt in self.captured
            )
            assert found, (
                f"No index on {table} covering "
                f"({expected_cols[0]}, {expected_cols[1]})"
            )

    def test_schema_sql_composite_indexes_match_migration(self) -> None:
        from src.infrastructure.database.memory_postgres_schema import (
            RUNTIME_STATE_SCHEMA_SQL,
            SCHEMA_SQL,
        )

        all_sql = list(SCHEMA_SQL.values()) + list(RUNTIME_STATE_SCHEMA_SQL)
        for table in ["agent_runtime_overrides", "channels", "config_files"]:
            index_found = any(
                "INDEX" in stmt.upper()
                and table in stmt
                and "tenant_id" in stmt
                for stmt in all_sql
            )
            assert index_found, (
                f"Schema SQL missing composite index for {table}"
            )
