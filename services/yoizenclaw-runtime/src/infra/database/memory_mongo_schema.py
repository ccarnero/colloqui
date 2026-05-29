"""MongoDB index definitions for yoizenclaw-runtime collections."""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

TENANT_COLLECTIONS: tuple[str, ...] = (
    "runtime_jobs",
    "runtime_job_executions",
    "embeddings",
    "agent_runtime_overrides",
    "channels",
    "config_files",
    "scoped_memories",
    "memory_approval_events",
)

RUNTIME_COLLECTIONS: tuple[str, ...] = (
    *TENANT_COLLECTIONS,
    "audit_log",
    "_leader_election",
)

COLLECTION_INDEXES: dict[str, list[dict[str, Any]]] = {
    "runtime_jobs": [
        {"keys": [("enabled", 1)]},
        {"keys": [("tenant_id", 1), ("id", 1)]},
        {"keys": [("schedule_type", 1)]},
        {"keys": [("deleted_at", 1)]},
    ],
    "runtime_job_executions": [
        {"keys": [("job_id", 1)]},
        {"keys": [("tenant_id", 1), ("job_id", 1)]},
        {"keys": [("status", 1)]},
        {"keys": [("started_at", -1)]},
    ],
    "embeddings": [
        {"keys": [("tenant_id", 1), ("id", 1)]},
    ],
    "agent_runtime_overrides": [
        {"keys": [("agent_id", 1)], "unique": True},
        {"keys": [("created_at", 1)]},
        {"keys": [("tenant_id", 1), ("agent_id", 1)]},
    ],
    "channels": [
        {"keys": [("channel", 1)], "unique": True},
        {"keys": [("agent_id", 1)]},
        {"keys": [("created_at", 1)]},
        {"keys": [("tenant_id", 1), ("channel", 1)]},
    ],
    "config_files": [
        {"keys": [("path", 1)], "unique": True},
        {"keys": [("category", 1)]},
        {"keys": [("created_at", 1)]},
        {"keys": [("tenant_id", 1), ("path", 1)]},
    ],
    "audit_log": [
        {"keys": [("scope", 1)]},
        {"keys": [("created_at", 1)]},
        {"keys": [("action", 1)]},
        {"keys": [("subject", 1)]},
    ],
    "scoped_memories": [
        {
            "keys": [
                ("tenant_id", 1),
                ("scope_type", 1),
                ("scope_id", 1),
                ("status", 1),
                ("namespace", 1),
                ("memory_key", 1),
                ("updated_at", -1),
            ],
        },
        {
            "keys": [
                ("tenant_id", 1),
                ("scope_type", 1),
                ("kind", 1),
                ("status", 1),
                ("updated_at", -1),
            ],
        },
    ],
    "memory_approval_events": [
        {
            "keys": [
                ("tenant_id", 1),
                ("scoped_memory_id", 1),
                ("created_at", -1),
            ],
        },
    ],
    "_leader_election": [
        {"keys": [("expiresAt", 1)], "expireAfterSeconds": 0},
    ],
}


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create all runtime collection indexes idempotently."""

    for collection_name in RUNTIME_COLLECTIONS:
        collection = db[collection_name]
        index_specs = COLLECTION_INDEXES.get(collection_name, [])
        for spec in index_specs:
            keys = spec["keys"]
            options = {key: value for key, value in spec.items() if key != "keys"}
            await collection.create_index(keys, **options)


async def ensure_schema(db: AsyncIOMotorDatabase) -> None:
    """Ensure MongoDB collections and indexes exist."""

    await ensure_indexes(db)
