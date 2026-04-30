from __future__ import annotations

from typing import Any

import pytest

from src.utils.chat import ChatRequest, generate_chat_reply


class _DummyRegistry:
    async def build_tenant_memory_context(
        self,
        _tools: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        return {
            "policy": {"instructions": "Always consider tenant notices."},
            "tenant": {
                "summary": "- [notice] Billing maintenance tonight",
                "items": [
                    {
                        "id": "memory-1",
                        "kind": "notice",
                        "title": "Billing maintenance",
                    }
                ],
            },
        }


class _DummyLlmClient:
    model = "mock-model"
    provider = "mock"


class _DummyAgent:
    def __init__(self) -> None:
        self.skills: list[dict[str, Any]] = []
        self.agent_metadata = {"id": "agent-1", "name": "Demo Agent"}
        self.llm_client = _DummyLlmClient()
        self.received_context: dict[str, Any] | None = None

    async def run(self, _prompt: str, context: dict[str, Any] | None = None) -> str:
        self.received_context = context
        return "ok"


@pytest.mark.asyncio
async def test_plain_run_receives_scoped_memory_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = _DummyAgent()

    async def _fake_get_chat_agent(_request: ChatRequest) -> _DummyAgent:
        return agent

    monkeypatch.setattr("src.utils.chat._get_chat_agent", _fake_get_chat_agent)
    monkeypatch.setattr("src.utils.chat.get_registry", lambda: _DummyRegistry())

    response = await generate_chat_reply(
        ChatRequest(
            agentId="agent-1",
            message="hello",
            conversationId="session-1",
            chatId="chat-1",
            userId="user-1",
        )
    )

    assert response.response == "ok"
    assert agent.received_context is not None
    assert agent.received_context["user_id"] == "user-1"
    assert agent.received_context["chat_id"] == "chat-1"
    assert agent.received_context["tenant_memory_summary"]
    assert agent.received_context["memory"]["tenant"]["items"][0]["kind"] == "notice"
