"""MongoDB-backed runtime configuration repository."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from src.app.memory.ports import IMemoryDatabaseProvider
from src.utils.config.agent_config import AgentSyncRequest, RECOVERY_AGENT_ID
from src.utils.config.settings import bootstrap_settings
from src.utils.logging.audit_logger import AuditEvent, write_audit_event


class _DateTimeEncoder(json.JSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


@dataclass(slots=True)
class _SeededFile:
    path: str
    content: str


class RuntimeConfigRepository:
    """Async repository for runtime config collections and audit events."""

    def __init__(
        self,
        config_dir: str | None = None,
        memory: IMemoryDatabaseProvider | None = None,
    ) -> None:
        self._config_dir = (
            Path(config_dir).resolve() if config_dir is not None else None
        )
        if memory is not None:
            self._memory = memory
        else:
            from src.app.memory import create_memory

            self._memory = create_memory()

    async def load_agent_config(
        self,
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Load the requested agent config from MongoDB."""

        await self._ensure_initialized()

        normalized_agent_id = self._normalize_agent_id(agent_id)
        config = await self._fetch_agent_config(normalized_agent_id)
        if config is not None:
            return config

        raise RuntimeError(
            f"Runtime agent configuration '{normalized_agent_id}' was not found",
        )

    async def load_all_agent_configs(self) -> dict[str, dict[str, object]]:
        """Load every runtime agent configuration from MongoDB."""

        await self._ensure_initialized()
        cursor = self._memory.db.agent_runtime_overrides.find(
            {"deleted_at": None},
        ).sort("agent_id", 1)
        return {
            str(document["agent_id"]): self._coerce_dict(document["config"])
            async for document in cursor
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
        resolved_tenant_id = self._resolve_tenant_id()
        now = datetime.now(timezone.utc)

        await self._memory.db.agent_runtime_overrides.update_one(
            {"agent_id": normalized_agent_id},
            {
                "$set": {
                    "id": str(uuid4()),
                    "tenant_id": resolved_tenant_id,
                    "agent_id": normalized_agent_id,
                    "config": runtime_payload,
                    "updated_at": now,
                    "deleted_at": None,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

        await write_audit_event(
            self._memory.db,
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
        await self._memory.db.agent_runtime_overrides.delete_one(
            {"agent_id": normalized_agent_id},
        )

        await write_audit_event(
            self._memory.db,
            AuditEvent(
                scope="runtime_config",
                action="agent.unpublish",
                subject=normalized_agent_id,
                details={"agent_id": normalized_agent_id},
            ),
        )

    async def load_channel_configs(self) -> dict[str, dict[str, object]]:
        """Load all channel routing documents."""

        await self._ensure_initialized()
        cursor = self._memory.db.channels.find({"deleted_at": None}).sort(
            "channel",
            1,
        )
        return {
            str(document["channel"]): {
                **self._coerce_dict(document["config"]),
                "agentId": document.get("agent_id"),
            }
            async for document in cursor
        }

    async def load_channel_config(
        self,
        channel: str,
    ) -> dict[str, object] | None:
        """Load a single channel routing document."""

        normalized_channel = channel.strip()
        if not normalized_channel:
            return None

        channels = await self.load_channel_configs()
        return channels.get(normalized_channel)

    async def sync_config_files(
        self,
        files: list[dict[str, str]],
        delete_paths: list[str],
        tenant_id: str | None = None,
    ) -> tuple[list[str], list[str]]:
        """Persist config-file sync changes to MongoDB and emit audit logs."""

        if not files and not delete_paths:
            raise RuntimeError("No config file changes supplied")

        await self._ensure_initialized()

        resolved_tenant_id = self._resolve_tenant_id(tenant_id)
        written_paths: list[str] = []
        deleted_paths: list[str] = []

        for file_payload in files:
            file_path = self._normalize_relative_path(
                str(file_payload.get("path", "")),
            )
            content = str(file_payload.get("content", ""))
            category = self._get_category(file_path)
            file_name = Path(file_path).name.strip() or "config-file"
            raw_format = str(file_payload.get("format", "")).strip().lower()
            file_format = (
                "json"
                if raw_format == "json" or Path(file_path).suffix.lower() == ".json"
                else "yaml"
            )
            now = datetime.now(timezone.utc)
            await self._memory.db.config_files.update_one(
                {"path": file_path},
                {
                    "$set": {
                        "id": str(uuid4()),
                        "name": file_name,
                        "tenant_id": resolved_tenant_id,
                        "path": file_path,
                        "category": category,
                        "content": content,
                        "format": file_format,
                        "updated_at": now,
                        "deleted_at": None,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
            await self._sync_runtime_collection_for_file(
                file_path,
                content,
                resolved_tenant_id,
            )
            written_paths.append(file_path)

        for raw_path in delete_paths:
            file_path = self._normalize_relative_path(raw_path)
            await self._memory.db.config_files.delete_one({"path": file_path})
            await self._delete_runtime_collection_for_file(file_path)
            deleted_paths.append(file_path)

        await write_audit_event(
            self._memory.db,
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
        document = await self._memory.db.agent_runtime_overrides.find_one(
            {
                "agent_id": agent_id,
                "deleted_at": None,
            },
        )
        if document is None:
            return None

        return self._coerce_dict(document["config"])

    async def _sync_runtime_collection_for_file(
        self,
        file_path: str,
        content: str,
        tenant_id: str | None = None,
    ) -> None:
        resolved_tenant_id = self._resolve_tenant_id(tenant_id)

        if self._is_agent_runtime_file(file_path):
            agent_id = self._get_agent_id_from_path(file_path)
            payload = yaml.safe_load(content) or {}
            if isinstance(payload, dict):
                validated = AgentSyncRequest.model_validate(payload)
                now = datetime.now(timezone.utc)
                await self._memory.db.agent_runtime_overrides.update_one(
                    {"agent_id": agent_id},
                    {
                        "$set": {
                            "id": str(uuid4()),
                            "tenant_id": resolved_tenant_id,
                            "agent_id": agent_id,
                            "config": validated.to_runtime_dict(),
                            "updated_at": now,
                            "deleted_at": None,
                        },
                        "$setOnInsert": {"created_at": now},
                    },
                    upsert=True,
                )
            return

        if self._is_channels_file(file_path):
            loaded = yaml.safe_load(content) or {}
            channels = loaded.get("channels")
            if not isinstance(channels, list):
                return

            await self._memory.db.channels.delete_many({})
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
                    if isinstance(raw_display_name, str)
                    and raw_display_name.strip()
                    else normalized_channel
                )
                now = datetime.now(timezone.utc)
                await self._memory.db.channels.update_one(
                    {"channel": normalized_channel},
                    {
                        "$set": {
                            "id": str(uuid4()),
                            "tenant_id": resolved_tenant_id,
                            "channel": normalized_channel,
                            "agent_id": agent_id,
                            "display_name": display_name,
                            "config": self._to_json_compatible_value(dict(item)),
                            "updated_at": now,
                            "deleted_at": None,
                        },
                        "$setOnInsert": {"created_at": now},
                    },
                    upsert=True,
                )

    async def _delete_runtime_collection_for_file(
        self,
        file_path: str,
    ) -> None:
        if self._is_agent_runtime_file(file_path):
            agent_id = self._get_agent_id_from_path(file_path)
            await self._memory.db.agent_runtime_overrides.delete_one(
                {"agent_id": agent_id},
            )
            return

        if self._is_channels_file(file_path):
            await self._memory.db.channels.delete_many({})

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
            (".yaml", ".yml"),
        )

    def _is_channels_file(self, relative_path: str) -> bool:
        return relative_path == "channels.yaml"

    def _get_agent_id_from_path(self, relative_path: str) -> str:
        return Path(relative_path).stem.strip() or RECOVERY_AGENT_ID

    def _to_json_compatible_value(self, value: object) -> object:
        return json.loads(json.dumps(value, cls=_DateTimeEncoder))

    def _resolve_tenant_id(self, tenant_id: str | None = None) -> str:
        if tenant_id is not None and tenant_id.strip():
            return tenant_id.strip()

        configured_tenant = str(bootstrap_settings.TENANT_ID).strip()
        return configured_tenant or "default"

    def _coerce_dict(self, value: object) -> dict[str, object]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            return json.loads(value)
        raise RuntimeError("Expected a mapping or JSON string from MongoDB")
