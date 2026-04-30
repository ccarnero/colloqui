"""Regression tests for pydantic-ai skill tool wiring."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from pydantic_ai.tools import Tool

from src.app.agents.agent import Agent


@pytest.mark.asyncio
async def test_agent_run_with_skill_passes_tool_instances_to_pydantic_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Agent must pass Tool instances via constructor, not legacy wrapper."""

    tool_executor_calls: dict[str, Any] = {}

    class _FakeToolExecutor:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.tools = []

        def resolve_skill_allowed_tools(self, skill: dict[str, Any]) -> list[str]:
            return ["memory"]

        def resolve_prompt_referenced_tools(
            self,
            skill: dict[str, Any],
            referenced_tool_names: list[str],
        ) -> tuple[list[str], list[str]]:
            return ([], [])

        def build_skill_tools(
            self,
            allowed_tool_names: list[str],
            state: dict[str, Any],
            tool_calls: list[dict[str, Any]],
        ) -> list[Tool]:
            tool_executor_calls["allowed_tool_names"] = allowed_tool_names

            async def _memory_tool(
                input: dict[str, Any] | None = None,
            ) -> dict[str, Any]:
                return {"ok": True, "input": input or {}}

            return [
                Tool(
                    _memory_tool,
                    name="memory",
                    description="Memory tool",
                )
            ]

    created_agents: list[dict[str, Any]] = []

    class _FakeRunResult:
        def __init__(self, output: str) -> None:
            self.output = output

    class _FakePydanticAgent:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            created_agents.append(kwargs)

        async def run(self, *args: Any, **kwargs: Any) -> _FakeRunResult:
            return _FakeRunResult("Skill reply")

    monkeypatch.setattr("src.app.agents.agent.ToolExecutor", _FakeToolExecutor)
    monkeypatch.setattr("pydantic_ai.Agent", _FakePydanticAgent)

    class _FakeLLMClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.model = "qwen/qwen3.5-9b"
            self.provider = "openai"

        def _get_pydantic_model(self) -> str:
            return "openai:qwen/qwen3.5-9b"

        async def generate(self, *args: Any, **kwargs: Any) -> Any:
            return SimpleNamespace(content="fallback")

    monkeypatch.setattr("src.app.agents.agent.LLMClient", _FakeLLMClient)

    agent = Agent(
        system_prompt="Base prompt",
        llm_config={"provider": "openai", "model": "qwen/qwen3.5-9b"},
        skills=[
            {
                "id": "skill-sales",
                "name": "sales_assistant",
                "description": "Sales",
                "enabled": True,
                "instructions": "Use tools carefully.",
                "allowedTools": ["memory"],
            }
        ],
    )

    result = await agent.run_with_skill("Necesito ayuda")

    assert result["response"] == "Skill reply"
    assert tool_executor_calls["allowed_tool_names"] == ["memory"]

    assert len(created_agents) == 1
    tools_arg = created_agents[0].get("tools")
    assert isinstance(tools_arg, list)
    assert len(tools_arg) == 1
    assert isinstance(tools_arg[0], Tool)
    assert tools_arg[0].name == "memory"
