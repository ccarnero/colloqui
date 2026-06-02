"""Compatibility re-export for runtime configuration repository."""

from src.utils.utils.runtime_config import (
    RuntimeConfigRepository,
    RuntimeConfigRepositoryProtocol,
    get_runtime_config_repository,
)

__all__ = [
    "RuntimeConfigRepository",
    "RuntimeConfigRepositoryProtocol",
    "get_runtime_config_repository",
]
