"""Provider implementations for DI container."""

from __future__ import annotations

from typing import Any, Callable, Generic, TypeVar

T = TypeVar("T")


class Provider(Generic[T]):
    """Base class for dependency providers."""

    __slots__ = ()

    def get(self) -> T:
        """Get the dependency instance."""
        raise NotImplementedError


class SingletonProvider(Provider[T]):
    """Provider that returns a pre-created singleton instance."""

    __slots__ = ("_instance",)

    def __init__(self, instance: T) -> None:
        self._instance = instance

    def get(self) -> T:
        return self._instance


class FactoryProvider(Provider[T]):
    """Provider that creates a new instance each time."""

    __slots__ = ("_factory",)

    def __init__(self, factory: Callable[[], T]) -> None:
        self._factory = factory

    def get(self) -> T:
        return self._factory()


class LazyProvider(Provider[T]):
    """Provider that lazily creates and caches a singleton."""

    __slots__ = ("_factory", "_instance", "_created")

    def __init__(self, factory: Callable[[], T]) -> None:
        self._factory = factory
        self._instance: T | None = None
        self._created = False

    def get(self) -> T:
        if not self._created:
            self._instance = self._factory()
            self._created = True
        return self._instance  # type: ignore[return-value]

    def reset(self) -> None:
        """Reset the lazy instance (for testing)."""
        self._instance = None
        self._created = False
