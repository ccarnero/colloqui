"""Factory helpers for building test data in E2E tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any


def make_session_id() -> str:
    return f"e2e-session-{uuid.uuid4()}"


def make_chat_id() -> str:
    return f"e2e-chat-{uuid.uuid4()}"


def make_turn_number(turn: int) -> int:
    return max(1, turn)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_multiturn_scenario(
    *,
    agent_id: str,
    session_id: str | None = None,
    messages: list[str],
) -> list[dict[str, Any]]:
    """Build a list of session-payload turns for a multi-turn conversation."""
    session = session_id or make_session_id()
    turns: list[dict[str, Any]] = []
    for i, message in enumerate(messages, start=1):
        turns.append(
            {
                "chat_id": make_chat_id(),
                "agent_id": agent_id,
                "message": message,
                "turn_number": make_turn_number(i),
                "session_id": session,
                "timestamp": now_iso(),
            }
        )
    return turns


def build_agent_config_for_sync(
    *,
    agent_id: str,
    name: str = "E2E Test Agent",
    description: str = "An agent for E2E testing",
    system_prompt: str = "You are a helpful test assistant.",
    enhanced: bool = False,
) -> dict[str, Any]:
    """Build an agent config matching AgentSyncRequest schema.

    This shape is what config_sync expects when writing to
    ``agents/runtime/<agent_id>.yaml``.
    It gets validated by ``AgentSyncRequest`` before persisting
    to ``agent_runtime_overrides``.

    Args:
        agent_id: Agent identifier
        name: Agent display name
        description: Agent description
        system_prompt: System prompt for the agent
        enhanced: Whether to use enhanced skill format
    """
    if enhanced:
        return {
            "agent_config": {  # NEW: Enhanced format wrapper
                "name": name,
                "description": description,
                "role": {
                    "name": name,
                    "description": description,
                    "systemPrompt": system_prompt,
                    "temperature": 0.7,
                    "maxTokens": 500,
                },
                "rules": ["Be helpful and accurate"],
                "responseStyle": "Friendly and professional",
                "llm": {
                    "provider": "openai",
                    "model": "lfm2.5-350m",
                },
                "skills": [
                    {
                        "id": "test-enhanced-skill",
                        "name": "test_enhanced_skill",
                        "description": "Enhanced test skill",
                        "enabled": True,
                        "instructions": "Process $COMPONENT in $ENV environment. Args: $ARGUMENTS",
                        "when_to_use": "Use when processing components",
                        "triggers": ["/test", "/process"],
                        "arguments": ["component", "env"],
                        "allowedTools": ["test_tool"],
                        "context_mode": "inline",
                        "priority": 10,
                    }
                ],
                "tools": [
                    {
                        "id": "test_tool",
                        "name": "test_tool",
                        "description": "Test tool",
                        "endpoint": "https://httpbin.org/post",
                        "method": "POST",
                        "enabled": True,
                    }
                ],
                "enableEnhancedSkills": True,
                "enableSkillRouting": True,
                "enableDiscoveryTools": True,
            }
        }
    else:
        # Legacy format (file-based)
        return [
            {
                "path": f"agents/runtime/{agent_id}.yaml",
                "content": f"""name: "{name}"
description: "{description}"
role:
  name: "{name}"
  description: "{description}"
  systemPrompt: "{system_prompt}"
  temperature: 0.7
  maxTokens: 500
rules: []
responseStyle: ""
llm:
  provider: openai
  model: lfm2.5-350m
skills: []
tools: []
""",
            }
        ]


def build_sales_lead(
    *,
    name: str = "Test Lead",
    company: str = "Test Corp",
    email: str = "test@example.com",
    interest: str = "general",
) -> dict[str, Any]:
    return {
        "name": name,
        "company": company,
        "email": email,
        "interest": interest,
        "qualified": False,
        "score": 0,
    }
