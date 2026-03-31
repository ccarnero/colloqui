"""Helpers to persist synced config files safely under the runtime config dir."""

from __future__ import annotations

import posixpath
from pathlib import Path

from src.shared.config.runtime_paths import get_runtime_config_dir


class ConfigFileSyncError(RuntimeError):
    """Raised when a synced config file path or payload is invalid."""


class ConfigFileStore:
    """Persist config files received from the backend into the runtime dir."""

    _ALLOWED_SUFFIXES = {".yaml", ".yml", ".txt", ".json", ".env"}

    def __init__(self, config_dir: str | None = None) -> None:
        self._config_dir = (
            Path(config_dir).resolve()
            if config_dir is not None
            else get_runtime_config_dir()
        )

    def sync_files(
        self,
        files: list[dict[str, str]] | None = None,
        delete_paths: list[str] | None = None,
    ) -> tuple[list[str], list[str]]:
        """Apply a mixed write/delete sync request and return normalized paths."""

        written_paths: list[str] = []
        deleted_file_paths: list[str] = []

        for item in files or []:
            file_path = self._normalize_path(item.get("path", ""))
            content = item.get("content")

            if not isinstance(content, str):
                raise ConfigFileSyncError(
                    f"Config file '{file_path}' is missing string content"
                )

            target_path = self._resolve_target_path(file_path)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content, encoding="utf-8")
            written_paths.append(file_path)

        for raw_path in delete_paths or []:
            file_path = self._normalize_path(raw_path)
            target_path = self._resolve_target_path(file_path)

            if target_path.exists():
                target_path.unlink()
                self._prune_empty_directories(target_path.parent)

            deleted_file_paths.append(file_path)

        if not written_paths and not deleted_file_paths:
            raise ConfigFileSyncError("No config file changes supplied")

        return written_paths, deleted_file_paths

    def write_files(self, files: list[dict[str, str]]) -> list[str]:
        """Write multiple config files and return their normalized paths."""

        written_paths, _ = self.sync_files(files=files)
        return written_paths

    def _normalize_path(self, raw_path: str) -> str:
        normalized = posixpath.normpath(raw_path.replace("\\", "/").strip())
        normalized = normalized.lstrip("/")

        if (
            not normalized
            or normalized == "."
            or normalized.startswith("../")
            or "/../" in normalized
        ):
            raise ConfigFileSyncError("Invalid config path")

        suffix = Path(normalized).suffix.lower()
        if suffix not in self._ALLOWED_SUFFIXES:
            raise ConfigFileSyncError(
                f"Unsupported config file type for '{normalized}'"
            )

        return normalized

    def _resolve_target_path(self, relative_path: str) -> Path:
        target_path = (self._config_dir / relative_path).resolve()

        try:
            target_path.relative_to(self._config_dir)
        except ValueError:
            raise ConfigFileSyncError("Invalid config path")

        return target_path

    def _prune_empty_directories(self, current_dir: Path) -> None:
        directory = current_dir

        while directory != self._config_dir:
            if not directory.exists():
                directory = directory.parent
                continue

            if any(directory.iterdir()):
                return

            directory.rmdir()
            directory = directory.parent
