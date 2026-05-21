"""Tests for ToolExecutor registry fallback behavior."""

from __future__ import annotations

from src.app.agents.tool_executor import ToolExecutor


class _FakeRegistry:
    def get_tools(self) -> list[dict[str, str]]:
        return [
            {"name": "communicate"},
            {"name": "memory"},
            {"name": "resource"},
        ]


def test_resolve_skill_allowed_tools_falls_back_to_registry_when_empty() -> None:
    executor = ToolExecutor(
        tools=[],
        tool_registry=_FakeRegistry(),
    )

    allowed = executor.resolve_skill_allowed_tools({"name": "sales"})

    assert allowed == ["communicate", "memory", "resource"]


def test_resolve_skill_allowed_tools_prefers_configured_tools_when_present() -> None:
    executor = ToolExecutor(
        tools=[
            {
                "id": "catalog",
                "name": "catalog",
                "endpoint": "/tools/catalog",
                "method": "POST",
                "enabled": True,
            }
        ],
        tool_registry=_FakeRegistry(),
    )

    allowed = executor.resolve_skill_allowed_tools({"name": "sales"})

    assert allowed == ["catalog"]


def test_prompt_referenced_tools_use_registry_fallback_when_no_configured_tools() -> (
    None
):
    executor = ToolExecutor(
        tools=[],
        tool_registry=_FakeRegistry(),
    )

    referenced, warnings = executor.resolve_prompt_referenced_tools(
        {"name": "sales", "allowedTools": ["memory"]},
        ["memory"],
    )

    assert referenced == ["memory"]
    assert warnings == []
