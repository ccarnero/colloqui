"""Port interfaces for the memory application layer.

Defines abstract interfaces that infrastructure adapters must implement,
allowing the application layer to remain decoupled from concrete backends.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from src.domain.entities.memory import MemoryBackend


@runtime_checkable
class IMemoryFactory(Protocol):
    """Port interface for creating memory backend instances.

    Infrastructure adapters register concrete implementations that
    the application layer can resolve without direct imports.
    """

    def create(self) -> MemoryBackend:
        """Create and return a new memory backend instance."""
        ...


@runtime_checkable
class IMemoryPoolProvider(Protocol):
    """Minimal interface for objects exposing an asyncpg pool.

    Used by repositories that need direct pool access but should
    not depend on the concrete Memory implementation.
    """

    @property
    def pool(self) -> object:
        """Return the initialized connection pool."""
        ...

    async def initialize(self) -> None:
        """Ensure the backend is initialized."""
        ...
