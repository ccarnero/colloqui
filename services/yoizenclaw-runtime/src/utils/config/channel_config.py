"""Helpers to resolve channel-to-agent routing from runtime config."""

from __future__ import annotations

from pathlib import Path

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.utils.utils.runtime_config import RuntimeConfigRepository


class ChannelConfigStore:
    """Load and query channel routing from PostgreSQL."""

    def __init__(
        self,
        file_path: str | None = None,
        repository: "RuntimeConfigRepository" | None = None,
    ) -> None:
        runtime_dir = (
            Path(file_path).resolve().parent if file_path is not None else None
        )
        if repository is not None:
            self._repository = repository
        else:
            from src.utils.utils.runtime_config import RuntimeConfigRepository

            self._repository = RuntimeConfigRepository(
                str(runtime_dir) if runtime_dir is not None else None,
            )

        self._channels: dict[str, dict[str, object]] = {}

    async def reload(self) -> None:
        """Reload channel routing from PostgreSQL."""

        self._channels = await self._repository.load_channel_configs()

    def get(self, channel: str) -> dict[str, object] | None:
        """Return the stored channel config, if present."""

        normalized_channel = channel.strip()
        if not normalized_channel:
            return None

        return self._channels.get(normalized_channel)

    def get_agent_id(self, channel: str) -> str | None:
        """Return the assigned agent id for the given channel."""

        channel_config = self.get(channel)
        if not isinstance(channel_config, dict):
            return None

        raw_agent_id = channel_config.get("agentId")
        if not isinstance(raw_agent_id, str):
            return None

        normalized_agent_id = raw_agent_id.strip()
        return normalized_agent_id or None
