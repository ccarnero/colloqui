"""Shared runtime configuration apply pipeline."""

from __future__ import annotations

from src.shared.config.config_files import ConfigFileStore


async def apply_runtime_config_sync(
    files: list[dict[str, str]] | None = None,
    delete_paths: list[str] | None = None,
) -> tuple[list[str], list[str]]:
    """Apply a runtime config file batch to disk, PostgreSQL, and in-memory state."""

    config_file_store = ConfigFileStore()
    from src.shared.utils.runtime_config import get_runtime_config_repository

    runtime_config_repository = get_runtime_config_repository()

    written_paths, deleted_paths = config_file_store.sync_files(
        files=files,
        delete_paths=delete_paths,
    )
    await runtime_config_repository.sync_config_files(
        files=files or [],
        delete_paths=delete_paths or [],
    )
    from src.application.agents.agent_manager import get_agent_manager

    await get_agent_manager().reload()

    return written_paths, deleted_paths
