"""Tests for agent published payload normalization."""

from __future__ import annotations

from src.messaging.handlers.agents import (
    _build_agent_config_from_payload,
    _extract_llm_from_model_config,
)


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
        "connector_id": None,
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


def test_build_agent_config_reads_llm_from_nested_model_config_llm() -> None:
    """Admin console stores provider/model under model_config.llm (see getAgentLlmConfig)."""
    payload = {
        "name": "Sales Assistant Agent",
        "system_prompt": "You are helpful.",
        "model_config": {
            "llm": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "connectorId": "conn-adapter-1",
            },
            "soul": "Professional",
            "rules": [],
        },
        "tools": [],
    }

    config = _build_agent_config_from_payload(payload)

    assert config["llm"]["provider"] == "openai"
    assert config["llm"]["model"] == "gpt-4o-mini"
    assert config["llm"]["connector_id"] == "conn-adapter-1"
    assert config["llm"]["credential_mode"] == "runtime-default"
    assert config["llm"]["credential_id"] is None


def test_build_agent_config_nested_llm_with_credential_id() -> None:
    payload = {
        "name": "Agent",
        "system_prompt": "Hi",
        "model_config": {
            "llm": {
                "provider": "anthropic",
                "model": "claude-3-5-sonnet-20241022",
                "credentialId": "cred-uuid",
            },
        },
        "tools": [],
    }

    config = _build_agent_config_from_payload(payload)

    assert config["llm"]["provider"] == "anthropic"
    assert config["llm"]["credential_id"] == "cred-uuid"
    assert config["llm"]["credential_mode"] == "profile"


def test_extract_llm_empty_nested_dict_falls_back_to_flat() -> None:
    """Empty model_config.llm {} is falsy; use root-level provider/model."""
    mc = {
        "llm": {},
        "provider": "openai",
        "model": "gpt-4o-mini",
    }
    llm = _extract_llm_from_model_config(mc)
    assert llm["provider"] == "openai"
    assert llm["model"] == "gpt-4o-mini"
