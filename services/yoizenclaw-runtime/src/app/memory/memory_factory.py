"""Database factory for the runtime memory backend."""

from src.domain.entities.memory import MemoryBackend
from src.infra.database import create_memory_store


def create_memory() -> MemoryBackend:
    """Create the memory backend for the configured storage engine."""

    return create_memory_store()
