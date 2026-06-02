"""Runtime configuration repository factory (postgres / mongo)."""

from __future__ import annotations

from typing import Any, Protocol

from src.utils.config.agent_config import AgentSyncRequest


class RuntimeConfigRepositoryProtocol(Protocol):
    """Protocol for runtime configuration persistence helpers."""

    async def load_agent_config(
        self,
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Load an agent configuration from storage."""

    async def load_all_agent_configs(self) -> dict[str, dict[str, object]]:
        """Load every published runtime agent configuration."""

    async def save_agent_config(
        self,
        payload: AgentSyncRequest | dict[str, object],
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Persist an agent configuration to storage."""

    async def remove_agent_config(self, agent_id: str | None = None) -> None:
        """Remove an agent configuration from storage."""

    async def load_channel_configs(self) -> dict[str, dict[str, object]]:
        """Load all channel routing entries from storage."""

    async def load_channel_config(
        self,
        channel: str,
    ) -> dict[str, object] | None:
        """Load a single channel routing entry from storage."""

    async def sync_config_files(
        self,
        files: list[dict[str, str]],
        delete_paths: list[str],
    ) -> tuple[list[str], list[str]]:
        """Persist a config-file sync batch to storage."""


class RuntimeConfigRepository:
    """Facade delegating to the engine-specific runtime config repository."""

    def __init__(
        self,
        config_dir: str | None = None,
        memory: object | None = None,
    ) -> None:
        from src.utils.config.settings import bootstrap_settings

        if bootstrap_settings.DB_ENGINE == "mongo":
            from src.utils.utils.runtime_config_mongo import (
                RuntimeConfigRepository as MongoRuntimeConfigRepository,
            )

            impl_cls = MongoRuntimeConfigRepository
        else:
            from src.utils.utils.runtime_config_postgres import (
                RuntimeConfigRepository as PostgresRuntimeConfigRepository,
            )

            impl_cls = PostgresRuntimeConfigRepository

        self._impl = impl_cls(config_dir=config_dir, memory=memory)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._impl, name)


def get_runtime_config_repository() -> RuntimeConfigRepository:
    """Return the singleton runtime configuration repository."""

    from src.utils.di import AppContainer

    container = AppContainer.get()
    if container.runtime_config_repository is None:
        container.runtime_config_repository = RuntimeConfigRepository()

    return container.runtime_config_repository
