"""Centralized agent resolution for the YoizenClaw runtime.

Manages runtime Agent instances, channel-to-agent routing, and
configuration lifecycle.  All domain logic lives in the backend;
this module only resolves *which* agent to use for a given request.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING, Any

from src.shared.config.agent_config import (
    AgentConfigStore,
    build_agent_system_prompt,
)
from src.shared.config.channel_config import ChannelConfigStore
from src.shared.config.prompts import PromptLoadError, PromptLoader
from src.shared.config.config_loader_settings import get_runtime_config_dir
from src.tools.registry import get_registry

if TYPE_CHECKING:
    from src.application.agents.agent import Agent

logger = logging.getLogger(__name__)


class AgentManager:
    """Resolves runtime agents by id or channel.

    Keeps an in-memory cache of Agent instances keyed by agent id and
    rebuilds them when the underlying configuration is reloaded.
    """

    def __init__(self) -> None:
        config_dir = get_runtime_config_dir()
        self._agent_store = AgentConfigStore(str(config_dir))
        self._channel_store = ChannelConfigStore(str(config_dir / "channels.yaml"))
        self._prompts = PromptLoader(str(config_dir / "prompts"))

        self._agent_cache: dict[str, Agent] = {}
        self._agent_config_cache: dict[str, dict[str, Any]] = {}
        self._agent_config: dict[str, Any] = {}
        self._default_agent_id: str | None = None
        self._base_system_prompt = self._load_base_prompt()
        self._system_prompt = self._base_system_prompt
        self._default_agent: Agent | None = None
        self._initialized = False
        self._configured = False
        self._init_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Initialize runtime infrastructure without requiring configuration."""

        await self._ensure_initialized()

    async def get_agent(self, agent_id: str | None = None) -> Agent:
        """Return a runtime agent for the given published agent id."""

        await self._ensure_initialized()
        self._ensure_configured()

        if not agent_id or not agent_id.strip():
            if self._default_agent is None:
                self._raise_not_configured()

            return self._default_agent

        normalized = agent_id.strip()
        cache_key = self._cache_key(normalized)
        cached = self._agent_cache.get(cache_key)
        if cached is not None:
            return cached

        agent_config = await self.get_agent_config(normalized)
        runtime_agent = self._build_agent_instance(agent_config)
        self._agent_cache[cache_key] = runtime_agent
        return runtime_agent

    async def get_agent_for_channel(self, channel: str) -> Agent:
        """Return the runtime agent assigned to the given channel."""

        await self._ensure_initialized()
        self._ensure_configured()
        agent_id = self._channel_store.get_agent_id(channel)
        return await self.get_agent(agent_id)

    async def get_agent_config(
        self,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Resolve the effective config for the selected agent id."""

        await self._ensure_initialized()
        self._ensure_configured()

        if not agent_id or not agent_id.strip():
            return self._agent_config

        normalized = agent_id.strip()
        cache_key = self._cache_key(normalized)
        cached = self._agent_config_cache.get(cache_key)
        if cached is not None:
            return cached

        resolved = await self._agent_store.load_agent_config(normalized)
        self._agent_config_cache[cache_key] = resolved
        return resolved

    async def get_agent_config_for_channel(self, channel: str) -> dict[str, Any]:
        """Return the effective agent config assigned to the given channel."""

        await self._ensure_initialized()
        agent_id = self._channel_store.get_agent_id(channel)
        return await self.get_agent_config(agent_id)

    async def update_agent_config(self, config: dict[str, Any]) -> None:
        """Update the agent configuration at runtime."""

        await self._agent_store.save_active_config(config)
        await self._reload()
        self._initialized = True

    async def remove_agent_config(self, name: str | None = None) -> None:
        """Remove agent configuration at runtime."""

        await self._agent_store.remove_active_config()
        await self._reload()
        self._initialized = True

    async def reload(self) -> None:
        """Reload all configuration from disk and clear caches."""

        logger.info("Reloading agent manager configuration...")
        self._prompts.reload_all()
        await self._channel_store.reload()
        await self._reload()
        self._initialized = True
        logger.info("Agent manager configuration reloaded")

    def is_configured(self) -> bool:
        """Return True when runtime configuration has been applied."""

        return self._configured

    def get_default_agent_config(self) -> dict[str, Any] | None:
        """Return the cached default agent configuration, if present."""

        if not self._configured:
            return None

        return dict(self._agent_config)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _cache_key(agent_id: str) -> str:
        """Build a tenant-scoped cache key from agent_id.

        Format: ``{tenant_id}:{agent_id}``.  The tenant prefix is read
        from ``TENANT_ID`` environment variable so the cache is
        defensively scoped per-tenant even though each Knative runtime
        serves a single tenant.
        """
        tenant_id = os.environ.get("TENANT_ID", "")
        return f"{tenant_id}:{agent_id.strip()}"

    async def _ensure_initialized(self) -> None:
        if self._initialized:
            return

        async with self._init_lock:
            if self._initialized:
                return

            logger.info("Initializing agent manager runtime infrastructure...")
            self._prompts.reload_all()
            self._reset_runtime_state()
            await self._sync_runtime_store()
            self._initialized = True
            logger.info("Agent manager runtime infrastructure initialized")

    async def _reload(self) -> None:
        all_agent_configs = await self._agent_store.load_all_agent_configs()
        self._agent_cache.clear()
        self._agent_config_cache = {
            self._cache_key(aid): cfg
            for aid, cfg in all_agent_configs.items()
        }

        if not all_agent_configs:
            self._reset_runtime_state()
            await self._sync_runtime_store()
            return

        self._default_agent_id, self._agent_config = next(
            iter(all_agent_configs.items()),
        )
        self._base_system_prompt = self._load_base_prompt()
        self._system_prompt = self._build_system_prompt(self._agent_config)
        self._default_agent = self._build_agent_instance(self._agent_config)
        self._configured = True
        await self._sync_runtime_store()

    def _load_base_prompt(self) -> str:
        try:
            return self._prompts.get("system/recovery_agent")
        except PromptLoadError:
            return "You are a helpful assistant."

    def _build_system_prompt(self, agent_config: dict[str, Any]) -> str:
        return build_agent_system_prompt(self._base_system_prompt, agent_config)

    def _build_agent_instance(self, agent_config: dict[str, Any]) -> Agent:
        from src.application.agents.agent import Agent

        return Agent(
            system_prompt=self._build_system_prompt(agent_config),
            llm_config=agent_config.get("llm"),
            tools=agent_config.get("tools"),
            skills=agent_config.get("skills"),
            prompt_loader=self._prompts,
            tool_registry=get_registry(),
            agent_metadata={
                "id": agent_config.get("id", self._default_agent_id or ""),
                "name": agent_config.get("name", ""),
                "description": agent_config.get("description", ""),
            },
        )

    def _reset_runtime_state(self) -> None:
        self._agent_cache.clear()
        self._agent_config_cache.clear()
        self._agent_config = {}
        self._default_agent = None
        self._default_agent_id = None
        self._configured = False
        self._base_system_prompt = self._load_base_prompt()
        self._system_prompt = self._base_system_prompt

    def _ensure_configured(self) -> None:
        if self._configured:
            return

        self._raise_not_configured()

    def _raise_not_configured(self) -> None:
        from src.shared.errors import RuntimeNotConfiguredError

        raise RuntimeNotConfiguredError(
            "Runtime not configured. Wait for backend configuration via sync.",
        )

    async def _sync_runtime_store(self) -> None:
        from src.interfaces.websocket import RuntimeConfigStore

        if not self._configured:
            RuntimeConfigStore.clear()
            return

        role = self._agent_config.get("role")
        llm = self._agent_config.get("llm")
        role_config = role if isinstance(role, dict) else {}
        llm_config = llm if isinstance(llm, dict) else {}

        await RuntimeConfigStore.update(
            {
                "agent": {
                    "system_prompt": str(
                        role_config.get("system_prompt")
                        or role_config.get("systemPrompt")
                        or "",
                    ),
                    "response_style": self._agent_config.get("response_style")
                    or self._agent_config.get("responseStyle")
                    or "",
                    "tone": "professional",
                    "rules": self._agent_config.get("rules", []),
                },
                "llm": {
                    "provider": llm_config.get("provider"),
                    "model": llm_config.get("model"),
                    "credential_mode": llm_config.get("credential_mode")
                    or llm_config.get("credentialMode")
                    or (
                        "profile"
                        if (
                            llm_config.get("credential_id")
                            or llm_config.get("credentialId")
                        )
                        else "runtime-default"
                    ),
                    "credential_id": llm_config.get("credential_id")
                    or llm_config.get("credentialId")
                    or "",
                    "temperature": role_config.get("temperature", 0.7),
                    "max_tokens": role_config.get("max_tokens")
                    or role_config.get("maxTokens")
                    or 1000,
                },
                "prompts": {},
                "tools": self._agent_config.get("tools", []),
                "intervals": {},
            }
        )


# ------------------------------------------------------------------
# Container access (replaces singleton pattern)
# ------------------------------------------------------------------


def _create_agent_manager() -> AgentManager:
    """Factory function for AgentManager singleton."""
    return AgentManager()


def get_agent_manager() -> AgentManager:
    """Return the AgentManager via Container."""
    from src.shared.di import get_container

    return get_container().get_or_create("agent_manager", _create_agent_manager)
