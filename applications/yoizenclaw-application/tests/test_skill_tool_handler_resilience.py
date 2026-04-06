"""Tests for skill tool handler error resilience."""

from __future__ import annotations

from typing import Any

import pytest

from src.app.agents.tool_executor import ToolExecutor


class _RaisingRegistry:
    async def communicate(self, **kwargs: Any) -> dict[str, Any]:
        raise TypeError("missing required fields")

    def get_tools(self) -> list[dict[str, str]]:
        return [{"name": "communicate"}]


@pytest.mark.asyncio
async def test_skill_tool_handler_returns_error_payload_without_raising() -> None:
    executor = ToolExecutor(
        tools=[],
        tool_registry=_RaisingRegistry(),
    )

    tool_calls: list[dict[str, Any]] = []
    state: dict[str, Any] = {}
    tools = executor.build_skill_tools(["communicate"], state, tool_calls)

    assert len(tools) == 1
    result = await tools[0].function(input={})

    assert isinstance(result, dict)
    assert result["success"] is False
    assert result["tool"] == "communicate"
    assert "missing required fields" in result["error"]

    assert len(tool_calls) == 1
    assert tool_calls[0]["tool"] == "communicate"
    assert tool_calls[0]["result"]["success"] is False
