"""Dependency Injection Container for YoizenClaw.

Provides a simple, thread-safe container for managing application-wide
dependencies with lazy initialization and singleton scoping.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, TypeVar

from src.shared.di.providers import Provider, SingletonProvider, FactoryProvider

T = TypeVar("T")


class Container:
    """Simple DI container with lazy initialization and singleton support."""

    _instance: Container | None = None
    _lock = asyncio.Lock()

    def __init__(self) -> None:
        self._providers: dict[str, Provider[Any]] = {}
        self._cache: dict[str, Any] = {}
        self._factories: dict[str, Callable[[], Any]] = {}

    @classmethod
    async def get_instance(cls) -> Container:
        """Get or create the singleton container instance."""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = Container()
        return cls._instance

    @classmethod
    def get_sync(cls) -> Container:
        """Get the singleton container instance (sync version)."""
        if cls._instance is None:
            cls._instance = Container()
        return cls._instance

    def register_singleton(self, key: str, factory: Callable[[], T]) -> None:
        """Register a singleton dependency.

        Args:
            key: Unique identifier for the dependency.
            factory: Factory function to create the instance.
        """
        self._factories[key] = factory

    def register_factory(self, key: str, factory: Callable[[], T]) -> None:
        """Register a factory dependency (new instance each time).

        Args:
            key: Unique identifier for the dependency.
            factory: Factory function to create the instance.
        """
        self._providers[key] = FactoryProvider(factory)

    def register_instance(self, key: str, instance: T) -> None:
        """Register an existing instance.

        Args:
            key: Unique identifier for the dependency.
            instance: The instance to register.
        """
        self._cache[key] = instance
        self._providers[key] = SingletonProvider(instance)

    def get(self, key: str) -> T:
        """Get a dependency by key.

        Args:
            key: The dependency identifier.

        Returns:
            The dependency instance.

        Raises:
            KeyError: If the dependency is not registered.
        """
        if key in self._cache:
            return self._cache[key]

        if key not in self._providers:
            raise KeyError(f"Dependency not registered: {key}")

        instance = self._providers[key].get()
        if isinstance(self._providers[key], SingletonProvider):
            self._cache[key] = instance
        return instance

    def get_or_create(self, key: str, factory: Callable[[], T]) -> T:
        """Get a dependency or create it if not exists.

        Args:
            key: The dependency identifier.
            factory: Factory function to create the instance if not exists.

        Returns:
            The dependency instance.
        """
        if key in self._cache:
            return self._cache[key]
        if key in self._factories:
            instance = self._factories[key]()
            self._cache[key] = instance
            return instance
        instance = factory()
        self._cache[key] = instance
        return instance

    def clear(self) -> None:
        """Clear all cached instances (for testing)."""
        self._cache.clear()

    def reset(self) -> None:
        """Reset the container entirely."""
        self._providers.clear()
        self._cache.clear()
        self._factories.clear()
        Container._instance = None


_container_sync = Container()


def get_container() -> Container:
    """Get the global container instance (sync version).

    Returns:
        The global Container instance.
    """
    return _container_sync
