"""Scoped memory repository factory (postgres / mongo)."""

from __future__ import annotations

from typing import Any


class ScopedMemoryRepository:
    """Facade delegating to the engine-specific scoped memory repository."""

    def __init__(self, memory: object | None = None) -> None:
        from src.utils.config.settings import bootstrap_settings

        if bootstrap_settings.DB_ENGINE == "mongo":
            from src.app.memory.scoped_repository_mongo import (
                ScopedMemoryRepository as MongoScopedMemoryRepository,
            )

            impl_cls = MongoScopedMemoryRepository
        else:
            from src.app.memory.scoped_repository_postgres import (
                ScopedMemoryRepository as PostgresScopedMemoryRepository,
            )

            impl_cls = PostgresScopedMemoryRepository

        self._impl = impl_cls(memory=memory)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._impl, name)
