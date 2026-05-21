"""Database factory for the PostgreSQL runtime backend."""

from src.domain.entities.memory import MemoryBackend


def create_memory() -> MemoryBackend:
    """Create the PostgreSQL memory backend used by the runtime.

    The concrete implementation is resolved lazily to keep the
    application layer free of infrastructure imports at module level.
    """

    from src.infra.database.memory_postgres import Memory as PostgresMemory

    return PostgresMemory()
