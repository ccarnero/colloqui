"""Tests for agent published payload normalization."""

from __future__ import annotations

from src.messaging.handlers.agents import _build_agent_config_from_payload


def test_build_agent_config_maps_subagents_into_skills() -> None:
    payload = {
        "name": "Sales Assistant",
        "description": "Sales helper",
        "system_prompt": "Main system prompt",
        "model_config": {
            "provider": "openai",
            "model": "qwen/qwen3.5-9b",
            "soul": "Warm and concise",
            "rules": "1. Ask context first\n2. Keep answers focused",
            "subagents": [
                {
                    "name": "discovery-master",
                    "description": "Discovery and qualification",
                    "system_prompt": "Ask BANT questions.",
                    "enabled": True,
                },
                {
                    "name": "handoff-preparer",
                    "description": "Prepare handoff summary",
                    "system_prompt": "Summarize for humans.",
                    "enabled": True,
                    "allowedTools": ["memory", "resource"],
                },
            ],
        },
        "tools": [
            {
                "name": "catalog",
                "endpoint": "/tools/catalog",
                "method": "post",
                "enabled": True,
            }
        ],
    }

    config = _build_agent_config_from_payload(payload)

    assert config["response_style"] == "Warm and concise"
    assert config["rules"] == ["Ask context first", "Keep answers focused"]
    assert config["llm"] == {
        "provider": "openai",
        "model": "qwen/qwen3.5-9b",
        "credential_mode": "runtime-default",
        "credential_id": None,
    }

    skills = config["skills"]
    assert len(skills) == 2
    assert skills[0]["name"] == "discovery-master"
    assert skills[0]["instructions"] == "Ask BANT questions."
    assert skills[1]["name"] == "handoff-preparer"
    assert skills[1]["allowedTools"] == ["memory", "resource"]

    tools = config["tools"]
    assert len(tools) == 1
    assert tools[0]["name"] == "catalog"
    assert tools[0]["id"] == "catalog"
    assert tools[0]["method"] == "POST"


def test_build_agent_config_prefers_explicit_skills_over_subagents() -> None:
    payload = {
        "name": "Agent",
        "system_prompt": "Main prompt",
        "skills": [
            {
                "id": "explicit-skill",
                "name": "explicit",
                "description": "Explicitly configured",
                "instructions": "Use explicit instructions.",
                "enabled": True,
            }
        ],
        "model_config": {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "subagents": [
                {
                    "name": "fallback-subagent",
                    "description": "Should not be used",
                    "system_prompt": "Fallback prompt",
                    "enabled": True,
                }
            ],
        },
        "tools": [],
    }

    config = _build_agent_config_from_payload(payload)

    skills = config["skills"]
    assert len(skills) == 1
    assert skills[0]["id"] == "explicit-skill"
    assert skills[0]["name"] == "explicit"
