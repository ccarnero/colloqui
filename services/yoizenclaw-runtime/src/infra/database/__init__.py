"""Storage engine factory for yoizenclaw-runtime persistence."""

from __future__ import annotations

from typing import Literal

from src.infra.database.memory_store import IMemoryStore, IVectorIndex
from src.utils.config.settings import bootstrap_settings

DbEngine = Literal["postgres", "mongo"]


def create_memory_store(
    engine: DbEngine | None = None,
) -> IMemoryStore & IVectorIndex:
    """Create the memory store for the requested storage engine."""

    resolved_engine = engine or bootstrap_settings.DB_ENGINE
    if resolved_engine == "mongo":
        from src.infra.database.memory_mongo import MemoryMongoStore

        return MemoryMongoStore()

    from src.infra.database.memory_postgres import MemoryPostgresStore

    return MemoryPostgresStore()
