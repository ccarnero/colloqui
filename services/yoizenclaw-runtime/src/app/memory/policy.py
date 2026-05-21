"""Helpers for agent-scoped memory policy resolution."""

from __future__ import annotations

from typing import Any

from src.app.memory.scoped_models import (
    DEFAULT_AUTO_READ_TENANT_KINDS,
    MemoryPolicy,
)


def resolve_memory_policy(tools: list[dict[str, Any]] | None) -> MemoryPolicy:
    """Resolve the effective memory policy from configured tools."""

    normalized_tools = tools or []
    for tool in normalized_tools:
        if not isinstance(tool, dict) or tool.get("enabled", True) is False:
            continue

        tool_name = str(tool.get("name", "")).strip()
        if tool_name != "memory":
            continue

        raw_policy = tool.get("memoryPolicy")
        if not isinstance(raw_policy, dict):
            raw_policy = tool.get("memory_policy")

        if not isinstance(raw_policy, dict):
            return MemoryPolicy(enabled=True)

        auto_read = raw_policy.get("autoReadTenantKinds")
        if not isinstance(auto_read, list):
            auto_read = raw_policy.get("auto_read_tenant_kinds")
        auto_read_kinds = [
            str(kind).strip()
            for kind in (auto_read or DEFAULT_AUTO_READ_TENANT_KINDS)
            if str(kind).strip()
        ]

        return MemoryPolicy(
            enabled=True,
            auto_read_tenant_kinds=auto_read_kinds
            or list(DEFAULT_AUTO_READ_TENANT_KINDS),
            allow_user_write=bool(raw_policy.get("allowUserWrite", True)),
            allow_tenant_proposal=bool(
                raw_policy.get("allowTenantProposal", True),
            ),
            instructions=str(raw_policy.get("instructions", "")).strip(),
        )

    return MemoryPolicy(enabled=False)
