"""Leader election factory for the runtime scheduler."""

from __future__ import annotations

from typing import Literal

from src.infra.database.memory_store import ILeaderElection, IMemoryStore
from src.services.mongo_ttl_leader import MongoTtlLeader
from src.services.postgres_advisory_leader import PostgresAdvisoryLeader
from src.utils.config.settings import bootstrap_settings

DbEngine = Literal["postgres", "mongo"]

# Backward-compatible aliases for existing imports.
SchedulerLeaderLock = PostgresAdvisoryLeader


def create_leader_election(
    memory: IMemoryStore,
    engine: DbEngine | None = None,
) -> ILeaderElection:
    """Create a leader-election adapter for the active storage engine."""

    resolved_engine = engine or bootstrap_settings.DB_ENGINE
    if resolved_engine == "mongo":
        mongo_store = memory
        if not hasattr(mongo_store, "db"):
            raise TypeError("Mongo leader election requires a store with a db property")
        return MongoTtlLeader(mongo_store.db)

    postgres_store = memory
    if not hasattr(postgres_store, "pool"):
        raise TypeError(
            "Postgres leader election requires a store with a pool property",
        )
    return PostgresAdvisoryLeader(postgres_store.pool)
