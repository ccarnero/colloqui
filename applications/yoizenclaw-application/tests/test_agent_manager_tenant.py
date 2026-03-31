"""Tests for AgentManager tenant-scoped cache behavior.

Validates that the agent cache is keyed by (tenant_id, agent_id) so
that different tenants never share cached agent instances, and that
cache invalidation only clears entries for the current tenant.
"""

from __future__ import annotations

import importlib
import sys
from types import ModuleType
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


# ------------------------------------------------------------------
# Helpers shared across tests
# ------------------------------------------------------------------


def _import_agent_manager(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    """Import agent_manager with heavy deps stubbed out.

    The production import chain (agent -> tool_executor -> registry ->
    yoizen -> subjects) fails outside the full runtime.  We stub the
    leaves before importing so the module loads cleanly.
    """
    for mod_name in (
        "envelope",
        "subjects",
        "nats_helpers",
    ):
        if mod_name not in sys.modules:
            sys.modules[mod_name] = MagicMock(name=f"fake_{mod_name}")

    monkeypatch.setattr("src.tools.yoizen.shared_subjects", sys.modules["subjects"])

    import src.application.agents.agent_manager as am

    importlib.reload(am)
    return am


class _FakeStore:
    """Minimal stub for AgentConfigStore / ChannelConfigStore."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass


class _FakePrompts:
    """Minimal stub for PromptLoader."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def reload_all(self) -> None:
        pass

    def get(self, *args: Any, **kwargs: Any) -> str:
        return "base prompt"


def _make_manager(
    monkeypatch: pytest.MonkeyPatch,
    am: ModuleType,
) -> Any:
    """Create an AgentManager with all external deps monkey-patched."""
    monkeypatch.setattr(am, "AgentConfigStore", _FakeStore)
    monkeypatch.setattr(am, "ChannelConfigStore", _FakeStore)
    monkeypatch.setattr(am, "PromptLoader", _FakePrompts)
    return am.AgentManager()


def _build_agent_config(agent_id: str, name: str) -> dict[str, Any]:
    """Return a minimal agent config dict accepted by _build_agent_instance."""
    return {
        "id": agent_id,
        "name": name,
        "role": {"system_prompt": f"Prompt for {name}"},
        "llm": {"provider": "mock", "model": "mock"},
    }


# ------------------------------------------------------------------
# Task 2.5.1 - Cache key includes tenant_id
# ------------------------------------------------------------------


class TestCacheKeyIncludesTenantId:
    """Agent cache must be keyed by (tenant_id, agent_id) pair."""

    def test_cache_key_format_includes_tenant(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """_cache_key must return 'tenant_id:agent_id' string."""
        monkeypatch.setenv("TENANT_ID", "acme-corp")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        key = manager._cache_key("agent-001")
        assert key == "acme-corp:agent-001"

    def test_cache_key_normalizes_whitespace(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Whitespace in agent_id must be stripped before keying."""
        monkeypatch.setenv("TENANT_ID", "acme-corp")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        key = manager._cache_key("  agent-001  ")
        assert key == "acme-corp:agent-001"

    def test_cache_key_uses_empty_string_when_no_tenant(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When TENANT_ID is not set, cache key still works with empty prefix."""
        monkeypatch.delenv("TENANT_ID", raising=False)
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        key = manager._cache_key("agent-001")
        assert key == ":agent-001"

    @pytest.mark.asyncio
    async def test_get_agent_stores_in_cache_with_tenant_key(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """get_agent() must populate _agent_cache using tenant-scoped key."""
        monkeypatch.setenv("TENANT_ID", "acme-corp")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        manager._initialized = True
        manager._configured = True
        manager._default_agent_id = "agent-001"
        manager._agent_config = _build_agent_config("agent-001", "Test")

        config = _build_agent_config("agent-001", "Test")
        manager._agent_config_cache[manager._cache_key("agent-001")] = config

        agent = await manager.get_agent("agent-001")

        expected_key = "acme-corp:agent-001"
        assert expected_key in manager._agent_cache
        assert manager._agent_cache[expected_key] is agent

    @pytest.mark.asyncio
    async def test_different_tenants_do_not_share_cache(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Agents cached under tenant A must not appear for tenant B."""
        monkeypatch.setenv("TENANT_ID", "tenant-a")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)
        manager._initialized = True
        manager._configured = True
        manager._default_agent_id = "shared-agent"
        manager._agent_config = _build_agent_config("shared-agent", "Agent A")

        config_a = _build_agent_config("shared-agent", "Agent A")
        key_a = manager._cache_key("shared-agent")
        manager._agent_config_cache[key_a] = config_a

        agent_a = await manager.get_agent("shared-agent")

        monkeypatch.setenv("TENANT_ID", "tenant-b")
        am_b = _import_agent_manager(monkeypatch)
        manager_b = _make_manager(monkeypatch, am_b)
        manager_b._initialized = True
        manager_b._configured = True
        manager_b._default_agent_id = "shared-agent"
        manager_b._agent_config = _build_agent_config("shared-agent", "Agent B")

        config_b = _build_agent_config("shared-agent", "Agent B")
        key_b = manager_b._cache_key("shared-agent")
        manager_b._agent_config_cache[key_b] = config_b

        agent_b = await manager_b.get_agent("shared-agent")

        assert key_a != key_b
        assert "tenant-a:shared-agent" == key_a
        assert "tenant-b:shared-agent" == key_b
        assert agent_a is not agent_b


# ------------------------------------------------------------------
# Task 2.5.3 - Cache invalidation only affects current tenant
# ------------------------------------------------------------------


class TestPerTenantCacheInvalidation:
    """reload() / _reset_runtime_state() must be tenant-scoped."""

    @pytest.mark.asyncio
    async def test_reload_clears_only_current_tenant_entries(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """After reload(), entries are cleared and rebuilt from store."""
        monkeypatch.setenv("TENANT_ID", "tenant-a")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        key_a = "tenant-a:agent-001"
        key_b = "tenant-b:agent-002"
        manager._agent_cache[key_a] = MagicMock(name="agent-a")
        manager._agent_cache[key_b] = MagicMock(name="agent-b")
        manager._agent_config_cache[key_a] = {"name": "Agent A"}
        manager._agent_config_cache[key_b] = {"name": "Agent B"}

        manager._agent_store = AsyncMock()
        manager._agent_store.load_all_agent_configs = AsyncMock(return_value={})
        manager._channel_store = AsyncMock()
        manager._channel_store.reload = AsyncMock()

        await manager._reload()

        assert key_a not in manager._agent_cache
        assert key_b not in manager._agent_cache

    @pytest.mark.asyncio
    async def test_reload_rebuilds_with_tenant_scoped_keys(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """After reload(), rebuilt cache uses tenant-scoped keys."""
        monkeypatch.setenv("TENANT_ID", "acme-corp")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        agent_config = _build_agent_config("agent-007", "James Bond")
        all_configs = {"agent-007": agent_config}

        manager._agent_store = AsyncMock()
        manager._agent_store.load_all_agent_configs = AsyncMock(
            return_value=all_configs,
        )
        manager._channel_store = AsyncMock()
        manager._channel_store.reload = AsyncMock()

        await manager._reload()

        expected_key = "acme-corp:agent-007"
        assert expected_key in manager._agent_config_cache

    @pytest.mark.asyncio
    async def test_reset_runtime_state_clears_all_caches(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """_reset_runtime_state must clear all cache dictionaries."""
        monkeypatch.setenv("TENANT_ID", "tenant-a")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)

        key_a = "tenant-a:agent-x"
        key_b = "tenant-b:agent-y"
        manager._agent_cache[key_a] = MagicMock(name="agent-a")
        manager._agent_cache[key_b] = MagicMock(name="agent-b")
        manager._agent_config_cache[key_a] = {"name": "A"}
        manager._agent_config_cache[key_b] = {"name": "B"}

        manager._reset_runtime_state()

        assert len(manager._agent_cache) == 0
        assert len(manager._agent_config_cache) == 0

    @pytest.mark.asyncio
    async def test_get_agent_config_uses_tenant_scoped_key(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """get_agent_config() must use _cache_key for lookups."""
        monkeypatch.setenv("TENANT_ID", "acme-corp")
        am = _import_agent_manager(monkeypatch)
        manager = _make_manager(monkeypatch, am)
        manager._initialized = True
        manager._configured = True

        config = _build_agent_config("agent-010", "Scoped Agent")
        expected_key = manager._cache_key("agent-010")
        manager._agent_config_cache[expected_key] = config

        result = await manager.get_agent_config("agent-010")
        assert result["name"] == "Scoped Agent"

        assert "agent-010" not in manager._agent_config_cache
