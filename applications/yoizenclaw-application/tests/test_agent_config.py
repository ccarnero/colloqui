"""Tests for agent configuration persistence and prompt composition."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from src.application.agents.agent import Agent
from src.interfaces.http.handlers import chat as chat_handler
from src.shared.config.agent_config import (
    AgentConfigStore,
    AgentSyncRequest,
    RECOVERY_AGENT_ID,
    build_agent_system_prompt,
    resolve_tool_definition,
)
from src.shared.config.channel_config import ChannelConfigStore


def _write_base_agent_config(config_dir: Path) -> None:
    agents_dir = config_dir / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    (agents_dir / "recovery.yaml").write_text(
        "\n".join(
            [
                'name: "recovery"',
                'description: "Base recovery config"',
                'tools:',
                '  - resource',
                '  - memory',
                '  - communicate',
                'skill: "recovery"',
            ]
        ),
        encoding="utf-8",
    )


class FakeRuntimeConfigRepository:
    def __init__(self) -> None:
        self.agent_configs: dict[str, dict[str, object]] = {
            RECOVERY_AGENT_ID: {
                "name": "Recovery Agent",
                "role": {"system_prompt": "Seeded prompt"},
                "llm": {"provider": "mock", "model": "mock"},
            }
        }
        self.channel_configs: dict[str, dict[str, object]] = {}
        self.saved_agent_ids: list[str] = []
        self.removed_agent_ids: list[str] = []

    async def load_agent_config(
        self,
        agent_id: str | None = None,
    ) -> dict[str, object]:
        normalized_agent_id = (
            agent_id.strip()
            if agent_id is not None and agent_id.strip()
            else RECOVERY_AGENT_ID
        )
        return self.agent_configs.get(
            normalized_agent_id,
            self.agent_configs[RECOVERY_AGENT_ID],
        )

    async def save_agent_config(
        self,
        payload: AgentSyncRequest | dict[str, object],
        agent_id: str | None = None,
    ) -> dict[str, object]:
        validated = (
            payload
            if isinstance(payload, AgentSyncRequest)
            else AgentSyncRequest.model_validate(payload)
        )
        normalized_agent_id = (
            agent_id.strip()
            if agent_id is not None and agent_id.strip()
            else RECOVERY_AGENT_ID
        )
        runtime_payload = validated.to_runtime_dict()
        self.agent_configs[normalized_agent_id] = runtime_payload
        self.saved_agent_ids.append(normalized_agent_id)
        return runtime_payload

    async def remove_agent_config(self, agent_id: str | None = None) -> None:
        normalized_agent_id = (
            agent_id.strip()
            if agent_id is not None and agent_id.strip()
            else RECOVERY_AGENT_ID
        )
        self.agent_configs.pop(normalized_agent_id, None)
        self.removed_agent_ids.append(normalized_agent_id)

    async def load_channel_configs(self) -> dict[str, dict[str, object]]:
        return self.channel_configs

    async def load_channel_config(
        self,
        channel: str,
    ) -> dict[str, object] | None:
        return self.channel_configs.get(channel.strip())


@pytest.mark.asyncio
async def test_agent_config_store_persists_runtime_override() -> None:
    repository = FakeRuntimeConfigRepository()
    store = AgentConfigStore(repository=repository)

    saved = await store.save_active_config(
        {
            "name": "Recovery Agent",
            "description": "Published recovery agent",
            "role": {
                "name": "Assistant",
                "description": "Recovery role",
                "systemPrompt": "Custom prompt",
                "temperature": 0.9,
                "maxTokens": 1200,
            },
            "rules": ["Keep it short"],
            "responseStyle": "Empathetic, calm, and concise.",
            "llm": {
                "provider": "zhipuai",
                "model": "glm-4",
                "credentialId": "zhipu-prod",
            },
            "skills": [
                {
                    "id": "skill-1",
                    "name": "Recovery",
                    "description": "Recover conversations",
                    "enabled": True,
                    "config": {},
                }
            ],
            "tools": [
                {
                    "id": "tool-1",
                    "name": "communicate",
                    "endpoint": "/tools/communicate",
                    "method": "POST",
                    "headers": {},
                    "enabled": True,
                }
            ],
        },
    )

    assert repository.saved_agent_ids == [RECOVERY_AGENT_ID]
    assert saved["name"] == "Recovery Agent"
    assert saved["role"]["system_prompt"] == "Custom prompt"
    assert saved["rules"] == ["Keep it short"]
    assert saved["response_style"] == "Empathetic, calm, and concise."
    assert saved["llm"] == {
        "provider": "zhipuai",
        "model": "glm-4",
        "credential_mode": "profile",
        "credential_id": "zhipu-prod",
    }
    assert saved["tools"][0]["name"] == "communicate"
    assert await store.load_active_config() == saved


@pytest.mark.asyncio
async def test_agent_config_store_uses_canonical_recovery_id() -> None:
    repository = FakeRuntimeConfigRepository()
    store = AgentConfigStore(repository=repository)

    saved = await store.save_active_config(
        {
            "name": "Recovery Agent",
            "role": {
                "name": "Assistant",
                "description": "Recovery role",
                "systemPrompt": "Canonical recovery prompt",
            },
        }
    )

    assert saved["name"] == "Recovery Agent"
    assert repository.saved_agent_ids == [RECOVERY_AGENT_ID]
    assert (
        await store.load_active_config()
    )["role"]["system_prompt"] == "Canonical recovery prompt"


@pytest.mark.asyncio
async def test_agent_config_store_loads_agent_specific_override() -> None:
    repository = FakeRuntimeConfigRepository()
    repository.agent_configs["agent-456"] = {
        "name": "Published Agent",
        "role": {"system_prompt": "Runtime prompt"},
        "response_style": "Direct",
    }

    store = AgentConfigStore(repository=repository)
    loaded = await store.load_agent_config("agent-456")

    assert loaded["name"] == "Published Agent"
    assert loaded["role"]["system_prompt"] == "Runtime prompt"
    assert loaded["response_style"] == "Direct"


def test_build_agent_system_prompt_includes_runtime_sections() -> None:
    prompt = build_agent_system_prompt(
        "Base prompt",
        {
            "role": {"system_prompt": "Published prompt"},
            "rules": ["Keep it warm", "Escalate urgent cases"],
            "responseStyle": "Empathetic\nConcise",
            "skills": [
                {
                    "name": "Recovery",
                    "description": "Recover abandoned conversations",
                    "enabled": True,
                },
                {
                    "name": "Hidden",
                    "description": "Do not include me",
                    "enabled": False,
                },
            ],
        },
    )

    assert "Published prompt" in prompt
    assert "Rules:" in prompt
    assert "Soul:" in prompt
    assert "Empathetic" in prompt
    assert "Enabled skills:" in prompt
    assert "Recover abandoned conversations" in prompt
    assert "Do not include me" not in prompt


def test_agent_sync_request_accepts_legacy_soul_skills() -> None:
    request = AgentSyncRequest.model_validate(
        {
            "name": "Recovery Agent",
            "role": {
                "name": "Assistant",
                "description": "Recovery role",
                "systemPrompt": "Custom prompt",
            },
            "soulSkills": ["Warm", "Direct"],
        }
    )

    assert request.response_style == "Warm\nDirect"


def test_agent_sync_request_accepts_llm_aliases() -> None:
    request = AgentSyncRequest.model_validate(
        {
            "name": "Recovery Agent",
            "role": {
                "name": "Assistant",
                "description": "Recovery role",
                "systemPrompt": "Custom prompt",
            },
            "llm_provider": "mock",
            "llm_model": "mock",
            "llm_credential_id": "ignored",
        }
    )

    assert request.llm.provider == "mock"
    assert request.llm.model == "mock"
    assert request.llm.credential_mode == "profile"
    assert request.llm.credential_id == "ignored"


def test_agent_sync_request_accepts_openai_provider() -> None:
    request = AgentSyncRequest.model_validate(
        {
            "name": "Recovery Agent",
            "role": {
                "name": "Assistant",
                "description": "Recovery role",
                "systemPrompt": "Custom prompt",
            },
            "llm": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "credentialId": "openai-prod",
            },
        }
    )

    assert request.llm.provider == "openai"
    assert request.llm.model == "gpt-4o-mini"
    assert request.llm.credential_mode == "profile"
    assert request.llm.credential_id == "openai-prod"


def test_agent_sync_request_ignores_legacy_flow_fields() -> None:
    request = AgentSyncRequest.model_validate(
        {
            "name": "Recovery Agent",
            "role": {
                "name": "Assistant",
                "description": "Recovery role",
                "systemPrompt": "Custom prompt",
            },
            "flows": [{"id": "flow-1", "name": "legacy"}],
            "execution": {"mode": "auto"},
        }
    )

    runtime_payload = request.to_runtime_dict()
    assert "flows" not in runtime_payload
    assert "execution" not in runtime_payload


def test_resolve_tool_definition_respects_active_override() -> None:
    config = {
        "tools": [
            {
                "name": "communicate",
                "endpoint": "/custom/communicate",
                "method": "POST",
                "enabled": True,
            },
            {
                "name": "resource",
                "endpoint": "/custom/resource",
                "method": "POST",
                "enabled": False,
            },
        ]
    }

    fallback = lambda tool_name: {
        "name": tool_name,
        "endpoint": f"/default/{tool_name}",
    }

    assert resolve_tool_definition("communicate", config, fallback) == {
        "name": "communicate",
        "endpoint": "/custom/communicate",
        "method": "POST",
        "enabled": True,
    }
    assert resolve_tool_definition("resource", config, fallback) is None
    assert resolve_tool_definition("memory", {}, fallback) == {
        "name": "memory",
        "endpoint": "/default/memory",
    }


def test_agent_manager_init_does_not_construct_default_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.application.agents import agent_manager as agent_manager_module

    class _FakeStore:
        def __init__(self, *args, **kwargs) -> None:
            pass

    class _FakePrompts:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def reload_all(self) -> None:
            pass

        def get(self, *args, **kwargs) -> str:
            return "base prompt"

    monkeypatch.setattr(agent_manager_module, "AgentConfigStore", _FakeStore)
    monkeypatch.setattr(agent_manager_module, "ChannelConfigStore", _FakeStore)
    monkeypatch.setattr(agent_manager_module, "PromptLoader", _FakePrompts)

    manager = agent_manager_module.AgentManager()

    assert manager._default_agent is None
    assert manager._initialized is False


@pytest.mark.asyncio
async def test_channel_config_store_resolves_assigned_agent() -> None:
    repository = FakeRuntimeConfigRepository()
    repository.channel_configs = {
        "webchat": {
            "channel": "webchat",
            "enabled": True,
            "displayName": "Webchat",
            "agentId": "agent-789",
            "welcomeMessage": "Hello",
            "responseMode": "demo",
        }
    }

    store = ChannelConfigStore(repository=repository)
    await store.reload()

    assert store.get_agent_id("webchat") == "agent-789"
    assert store.get_agent_id("slack") is None


@pytest.mark.asyncio
async def test_agent_run_with_skill_uses_selected_skill_instructions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = Agent(
        system_prompt="Base system prompt",
        llm_config={"provider": "openai", "model": "gpt-5.4-mini"},
        skills=[
            {
                "id": "skill-sales",
                "name": "sales_general",
                "description": "General sales",
                "enabled": True,
                "instructions": "Always answer in Spanish.",
                "allowedTools": [],
            }
        ],
    )

    async def fake_generate(
        prompt: str,
        system_prompt: str | None = None,
    ) -> SimpleNamespace:
        assert prompt == "Necesito una demo"
        assert system_prompt is not None
        assert "Always answer in Spanish." in system_prompt
        return SimpleNamespace(content="Claro, te ayudo con la demo.")

    monkeypatch.setattr(agent.llm_client, "generate", fake_generate)

    result = await agent.run_with_skill(
        "Necesito una demo",
        skill_name="skill-sales",
    )

    assert result["response"] == "Claro, te ayudo con la demo."
    assert result["state"]["active_skill"] == "sales_general"


@pytest.mark.asyncio
async def test_agent_run_renders_namespaced_prompt_variables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = Agent(
        system_prompt=(
            "You are {{agent.name}}. "
            "Talk to {{input.customer_name}} on {{context.channel}}."
        ),
        llm_config={"provider": "openai", "model": "gpt-5.4-mini"},
        agent_metadata={"name": "Recovery Agent"},
    )

    async def fake_generate(
        prompt: str,
        system_prompt: str | None = None,
    ) -> SimpleNamespace:
        assert prompt == "Hola"
        assert system_prompt == (
            "You are Recovery Agent. Talk to Pedro on webchat."
        )
        return SimpleNamespace(content="Respuesta")

    monkeypatch.setattr(agent.llm_client, "generate", fake_generate)

    response = await agent.run(
        "Hola",
        context={
            "input": {"customer_name": "Pedro"},
            "context": {"channel": "webchat"},
        },
    )

    assert response == "Respuesta"


@pytest.mark.asyncio
async def test_agent_run_with_skill_prefers_prompt_referenced_skill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = Agent(
        system_prompt="Use @skill:negociar when pricing is requested.",
        llm_config={"provider": "openai", "model": "gpt-5.4-mini"},
        skills=[
            {
                "id": "skill-default",
                "name": "default",
                "description": "Default skill",
                "enabled": True,
                "instructions": "Default instructions.",
                "allowedTools": [],
            },
            {
                "id": "skill-negociar",
                "name": "negociar",
                "description": "Negotiation skill",
                "enabled": True,
                "instructions": "Negotiate in a concise way.",
                "allowedTools": [],
            },
        ],
    )

    async def fake_generate(
        prompt: str,
        system_prompt: str | None = None,
    ) -> SimpleNamespace:
        assert system_prompt is not None
        assert "Active skill: negociar" in system_prompt
        assert "@skill:negociar" not in system_prompt
        return SimpleNamespace(content="Negociemos")

    monkeypatch.setattr(agent.llm_client, "generate", fake_generate)

    result = await agent.run_with_skill("Necesito precio")

    assert result["response"] == "Negociemos"
    assert result["state"]["active_skill"] == "negociar"


@pytest.mark.asyncio
async def test_agent_run_with_skill_warns_for_tool_reference_not_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = Agent(
        system_prompt="Use @tool:memory and @tool:catalog when needed.",
        llm_config={"provider": "openai", "model": "gpt-5.4-mini"},
        skills=[
            {
                "id": "skill-sales",
                "name": "sales_assistant",
                "description": "Sales skill",
                "enabled": True,
                "instructions": "Guide the lead.",
                "allowedTools": ["catalog"],
            }
        ],
        tools=[
            {
                "id": "tool-memory",
                "name": "memory",
                "endpoint": "runtime://memory",
                "method": "POST",
                "headers": {},
                "enabled": True,
            },
            {
                "id": "tool-catalog",
                "name": "catalog",
                "endpoint": "/tools/catalog",
                "method": "POST",
                "headers": {},
                "enabled": True,
            },
        ],
    )

    async def fake_generate(
        prompt: str,
        system_prompt: str | None = None,
    ) -> SimpleNamespace:
        assert system_prompt is not None
        assert "Prompt-referenced tools: catalog." in system_prompt
        assert "@tool:memory" not in system_prompt
        return SimpleNamespace(content="Listo")

    monkeypatch.setattr(agent.llm_client, "generate", fake_generate)
    monkeypatch.setattr(agent.llm_client, "supports_tool_execution", lambda: False)

    result = await agent.run_with_skill("Quiero cotizar")

    assert result["response"] == "Listo"
    assert any(
        "@tool:memory" in warning for warning in result["state"]["warnings"]
    )


@pytest.mark.asyncio
async def test_chat_handler_uses_run_with_skill_when_agent_has_skills(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeAgent:
        def __init__(self) -> None:
            self.skills = [{"id": "skill-sales", "name": "sales_assistant"}]
            self.received_context: dict[str, object] = {}

        async def run_with_skill(
            self,
            user_prompt: str,
            context: dict[str, object] | None = None,
            skill_name: str | None = None,
        ) -> dict[str, object]:
            self.received_context = context or {}
            return {
                "response": "Skill reply",
                "tool_calls": [{"tool": "resource"}],
            }

        async def run(self, user_prompt: str) -> str:
            raise AssertionError("run() should not be called when skills are available")

    fake_agent = FakeAgent()

    async def fake_get_chat_agent(
        request: chat_handler.ChatRequest,
    ) -> FakeAgent:
        return fake_agent

    monkeypatch.setattr(chat_handler, "_get_chat_agent", fake_get_chat_agent)

    response = await chat_handler.generate_chat_reply(
        chat_handler.ChatRequest(
            agentId="agent-sales-assistant",
            message="Necesito seguir con la conversacion",
            customerName="Pedro",
            conversationId="conv-12e2bc34",
            channel="webchat",
            context=[
                chat_handler.ChatContextMessage(
                    sender="customer",
                    content="Hola",
                ),
            ],
        ),
    )

    assert response.reply == "Skill reply"
    assert response.tool_calls == [{"tool": "resource"}]
    assert fake_agent.received_context["conversation_id"] == "conv-12e2bc34"
    assert fake_agent.received_context["customer_message"] == (
        "Necesito seguir con la conversacion"
    )
    assert fake_agent.received_context["conversation_history"] == "customer: Hola"
    assert fake_agent.received_context["input"]["customer_name"] == "Pedro"
    assert fake_agent.received_context["context"]["channel"] == "webchat"


@pytest.mark.asyncio
async def test_chat_handler_falls_back_to_plain_run_without_skills(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeAgent:
        def __init__(self) -> None:
            self.skills: list[dict[str, object]] = []

        async def run_with_skill(
            self,
            user_prompt: str,
            context: dict[str, object] | None = None,
            skill_name: str | None = None,
        ) -> dict[str, object]:
            raise AssertionError("run_with_skill() should not be called")

        async def run(
            self,
            user_prompt: str,
            context: dict[str, object] | None = None,
        ) -> str:
            return "Plain reply"

    fake_agent = FakeAgent()

    async def fake_get_chat_agent(
        request: chat_handler.ChatRequest,
    ) -> FakeAgent:
        return fake_agent

    monkeypatch.setattr(chat_handler, "_get_chat_agent", fake_get_chat_agent)

    response = await chat_handler.generate_chat_reply(
        chat_handler.ChatRequest(
            agentId="agent-sales-assistant",
            message="Solo quiero una respuesta simple",
        ),
    )

    assert response.reply == "Plain reply"
