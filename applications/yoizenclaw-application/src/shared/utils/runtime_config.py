"""PostgreSQL-backed runtime configuration repository."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

import yaml


class _DateTimeEncoder(json.JSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)

from src.shared.config.agent_config import AgentSyncRequest, RECOVERY_AGENT_ID
from src.shared.logging.audit_logger import AuditEvent, write_audit_event
from src.application.memory.ports import IMemoryPoolProvider


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


@dataclass(slots=True)
class _SeededFile:
    path: str
    content: str


class RuntimeConfigRepository:
    """Async repository for runtime config tables and audit events."""

    def __init__(
        self,
        config_dir: str | None = None,
        memory: IMemoryPoolProvider | None = None,
    ) -> None:
        self._config_dir = Path(config_dir).resolve() if config_dir is not None else None
        if memory is not None:
            self._memory = memory
        else:
            from src.infrastructure.database.memory_postgres import Memory

            self._memory = Memory()

    async def load_agent_config(
        self,
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Load the requested agent config from PostgreSQL."""

        await self._ensure_initialized()

        normalized_agent_id = self._normalize_agent_id(agent_id)
        config = await self._fetch_agent_config(normalized_agent_id)
        if config is not None:
            return config

        raise RuntimeError(
            f"Runtime agent configuration '{normalized_agent_id}' was not found",
        )

    async def load_all_agent_configs(self) -> dict[str, dict[str, object]]:
        """Load every runtime agent configuration from PostgreSQL."""

        await self._ensure_initialized()

        async with self._memory.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT agent_id, config
                FROM agent_runtime_overrides
                ORDER BY agent_id ASC
                """
            )

        return {
            str(row["agent_id"]): self._coerce_dict(row["config"])
            for row in rows
        }

    async def save_agent_config(
        self,
        payload: AgentSyncRequest | dict[str, object],
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Persist an agent config and emit an audit record."""

        await self._ensure_initialized()

        validated = (
            payload
            if isinstance(payload, AgentSyncRequest)
            else AgentSyncRequest.model_validate(payload)
        )
        runtime_payload = validated.to_runtime_dict()
        normalized_agent_id = self._normalize_agent_id(agent_id)

        async with self._memory.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO agent_runtime_overrides
                (id, agent_id, config, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $4)
                ON CONFLICT (agent_id) DO UPDATE SET
                    config = EXCLUDED.config,
                    updated_at = EXCLUDED.updated_at
                """,
                str(uuid4()),
                normalized_agent_id,
                runtime_payload,
                datetime.now(timezone.utc),
            )

        await write_audit_event(
            self._memory.pool,
            AuditEvent(
                scope="runtime_config",
                action="agent.publish",
                subject=normalized_agent_id,
                details={
                    "name": runtime_payload.get("name"),
                    "agent_id": normalized_agent_id,
                },
            ),
        )
        return runtime_payload

    async def remove_agent_config(self, agent_id: str | None = None) -> None:
        """Delete an agent config and emit an audit record."""

        await self._ensure_initialized()

        normalized_agent_id = self._normalize_agent_id(agent_id)

        async with self._memory.pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM agent_runtime_overrides WHERE agent_id = $1",
                normalized_agent_id,
            )

        await write_audit_event(
            self._memory.pool,
            AuditEvent(
                scope="runtime_config",
                action="agent.unpublish",
                subject=normalized_agent_id,
                details={"agent_id": normalized_agent_id},
            ),
        )

    async def load_channel_configs(self) -> dict[str, dict[str, object]]:
        """Load all channel routing rows."""

        await self._ensure_initialized()

        async with self._memory.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT channel, agent_id, config
                FROM channels
                ORDER BY channel ASC
                """
            )

        return {
            str(row["channel"]): {
                **self._coerce_dict(row["config"]),
                "agentId": row["agent_id"],
            }
            for row in rows
        }

    async def load_channel_config(
        self,
        channel: str,
    ) -> dict[str, object] | None:
        """Load a single channel routing row."""

        normalized_channel = channel.strip()
        if not normalized_channel:
            return None

        channels = await self.load_channel_configs()
        return channels.get(normalized_channel)

    async def sync_config_files(
        self,
        files: list[dict[str, str]],
        delete_paths: list[str],
    ) -> tuple[list[str], list[str]]:
        """Persist config-file sync changes to Postgres and emit audit logs."""

        if not files and not delete_paths:
            raise RuntimeError("No config file changes supplied")

        await self._ensure_initialized()

        written_paths: list[str] = []
        deleted_paths: list[str] = []

        async with self._memory.pool.acquire() as conn:
            for file_payload in files:
                file_path = self._normalize_relative_path(
                    str(file_payload.get("path", ""))
                )
                content = str(file_payload.get("content", ""))
                category = self._get_category(file_path)

                await conn.execute(
                    """
                    INSERT INTO config_files
                    (id, path, category, content, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $5)
                    ON CONFLICT (path) DO UPDATE SET
                        category = EXCLUDED.category,
                        content = EXCLUDED.content,
                        updated_at = EXCLUDED.updated_at
                    """,
                    str(uuid4()),
                    file_path,
                    category,
                    content,
                    datetime.now(timezone.utc),
                )

                await self._sync_runtime_table_for_file(conn, file_path, content)
                written_paths.append(file_path)

            for raw_path in delete_paths:
                file_path = self._normalize_relative_path(raw_path)
                await conn.execute(
                    "DELETE FROM config_files WHERE path = $1",
                    file_path,
                )
                await self._delete_runtime_table_for_file(conn, file_path)
                deleted_paths.append(file_path)

        await write_audit_event(
            self._memory.pool,
            AuditEvent(
                scope="runtime_config",
                action="config_files.sync",
                subject="config_files",
                details={
                    "written_paths": written_paths,
                    "deleted_paths": deleted_paths,
                },
            ),
        )

        return written_paths, deleted_paths

    async def _ensure_initialized(self) -> None:
        await self._memory.initialize()

    async def _fetch_agent_config(
        self,
        agent_id: str,
    ) -> dict[str, object] | None:
        async with self._memory.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT config
                FROM agent_runtime_overrides
                WHERE agent_id = $1
                """,
                agent_id,
            )

        if row is None:
            return None

        return self._coerce_dict(row["config"])

    async def _sync_runtime_table_for_file(
        self,
        conn,
        file_path: str,
        content: str,
    ) -> None:
        if self._is_agent_runtime_file(file_path):
            agent_id = self._get_agent_id_from_path(file_path)
            payload = yaml.safe_load(content) or {}
            if isinstance(payload, dict):
                validated = AgentSyncRequest.model_validate(payload)
                await conn.execute(
                    """
                    INSERT INTO agent_runtime_overrides
                    (id, agent_id, config, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $4)
                    ON CONFLICT (agent_id) DO UPDATE SET
                        config = EXCLUDED.config,
                        updated_at = EXCLUDED.updated_at
                    """,
                    str(uuid4()),
                    agent_id,
                    validated.to_runtime_dict(),
                    datetime.now(timezone.utc),
                )
            return

        if self._is_channels_file(file_path):
            loaded = yaml.safe_load(content) or {}
            channels = loaded.get("channels")
            if not isinstance(channels, list):
                return

            await conn.execute("DELETE FROM channels")
            for item in channels:
                if not isinstance(item, dict):
                    continue

                raw_channel = item.get("channel")
                if not isinstance(raw_channel, str):
                    continue

                normalized_channel = raw_channel.strip()
                if not normalized_channel:
                    continue

                raw_agent_id = item.get("agentId")
                agent_id = (
                    raw_agent_id.strip()
                    if isinstance(raw_agent_id, str) and raw_agent_id.strip()
                    else None
                )

                raw_display_name = item.get("displayName")
                display_name = (
                    raw_display_name.strip()
                    if isinstance(raw_display_name, str) and raw_display_name.strip()
                    else normalized_channel
                )

                await conn.execute(
                    """
                    INSERT INTO channels
                    (id, channel, agent_id, display_name, config, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $6)
                    ON CONFLICT (channel) DO UPDATE SET
                        agent_id = EXCLUDED.agent_id,
                        display_name = EXCLUDED.display_name,
                        config = EXCLUDED.config,
                        updated_at = EXCLUDED.updated_at
                    """,
                    str(uuid4()),
                    normalized_channel,
                    agent_id,
                    display_name,
                    self._to_json_compatible_value(dict(item)),
                    datetime.now(timezone.utc),
                )

    async def _delete_runtime_table_for_file(
        self,
        conn,
        file_path: str,
    ) -> None:
        if self._is_agent_runtime_file(file_path):
            agent_id = self._get_agent_id_from_path(file_path)
            await conn.execute(
                "DELETE FROM agent_runtime_overrides WHERE agent_id = $1",
                agent_id,
            )
            return

        if self._is_channels_file(file_path):
            await conn.execute("DELETE FROM channels")

    def _normalize_agent_id(self, agent_id: str | None) -> str:
        if not agent_id:
            return RECOVERY_AGENT_ID

        normalized_agent_id = agent_id.strip()
        return normalized_agent_id or RECOVERY_AGENT_ID

    def _normalize_relative_path(self, raw_path: str) -> str:
        normalized_path = raw_path.replace("\\", "/").strip().lstrip("/")
        if not normalized_path:
            raise RuntimeError("Invalid config path")

        if "../" in normalized_path or normalized_path.startswith("../"):
            raise RuntimeError("Invalid config path")

        return normalized_path

    def _get_category(self, relative_path: str) -> str:
        if "/" in relative_path:
            return relative_path.split("/", 1)[0]

        return Path(relative_path).stem

    def _is_agent_runtime_file(self, relative_path: str) -> bool:
        return relative_path.startswith("agents/runtime/") and relative_path.endswith(
            (".yaml", ".yml")
        )

    def _is_channels_file(self, relative_path: str) -> bool:
        return relative_path == "channels.yaml"

    def _get_agent_id_from_path(self, relative_path: str) -> str:
        return Path(relative_path).stem.strip() or RECOVERY_AGENT_ID

    def _to_json_compatible_value(self, value: object) -> object:
        return json.loads(json.dumps(value, cls=_DateTimeEncoder))

    def _coerce_dict(self, value: object) -> dict[str, object]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            return json.loads(value)
        raise RuntimeError("Expected a mapping or JSON string from PostgreSQL")


def get_runtime_config_repository() -> RuntimeConfigRepository:
    """Return the singleton runtime configuration repository."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.runtime_config_repository is None:
        container.runtime_config_repository = RuntimeConfigRepository()

    return container.runtime_config_repository
