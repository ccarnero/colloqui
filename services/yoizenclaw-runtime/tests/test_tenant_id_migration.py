"""Tests for tenant_id Mongo index definitions."""

from __future__ import annotations

import pytest

from src.infra.database.memory_mongo_schema import (
    COLLECTION_INDEXES,
    TENANT_COLLECTIONS,
)


EXPECTED_COMPOSITE_INDEXES: dict[str, tuple[str, str]] = {
    "agent_runtime_overrides": ("tenant_id", "agent_id"),
    "config_files": ("tenant_id", "path"),
    "channels": ("tenant_id", "channel"),
    "runtime_jobs": ("tenant_id", "id"),
    "runtime_job_executions": ("tenant_id", "job_id"),
    "embeddings": ("tenant_id", "id"),
}


class TestTenantCollections:
    def test_tenant_collections_include_runtime_tables(self) -> None:
        for table in [
            "runtime_jobs",
            "runtime_job_executions",
            "embeddings",
            "agent_runtime_overrides",
            "channels",
            "config_files",
        ]:
            assert table in TENANT_COLLECTIONS


class TestCompositeIndexOptimization:
    def test_tenant_id_is_leading_column_in_all_indexes(self) -> None:
        for table in EXPECTED_COMPOSITE_INDEXES:
            index_specs = COLLECTION_INDEXES.get(table, [])
            composite_specs = [
                spec
                for spec in index_specs
                if any(key == "tenant_id" for key, _direction in spec["keys"])
            ]
            assert composite_specs, f"No composite index found for {table}"
            for spec in composite_specs:
                keys = spec["keys"]
                assert keys[0][0] == "tenant_id", (
                    f"Index on {table} must lead with tenant_id, got {keys}"
                )

    def test_indexes_cover_primary_query_patterns(self) -> None:
        for table, expected_cols in EXPECTED_COMPOSITE_INDEXES.items():
            found = any(
                spec["keys"][0] == (expected_cols[0], 1)
                and any(key == expected_cols[1] for key, _direction in spec["keys"])
                for spec in COLLECTION_INDEXES.get(table, [])
            )
            assert found, (
                f"No index on {table} covering "
                f"({expected_cols[0]}, {expected_cols[1]})"
            )

    def test_leader_election_ttl_index_exists(self) -> None:
        leader_indexes = COLLECTION_INDEXES["_leader_election"]
        assert any(
            spec.get("expireAfterSeconds") == 0 for spec in leader_indexes
        )
