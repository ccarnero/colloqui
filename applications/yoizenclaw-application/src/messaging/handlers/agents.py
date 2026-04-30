"""Handler for agent-related NATS messages."""

from __future__ import annotations

import logging
import re
from typing import Any

from nats.aio.msg import Msg
from opentelemetry import trace

from src.messaging._nats_tracing import TracedNatsHandler
from src.utils.config.settings import bootstrap_settings

import subjects as shared_subjects

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)
_IDENTIFIER_SANITIZER = re.compile(r"[^a-zA-Z0-9_-]+")


def build_subject(action: str) -> str:
    """Build NATS subject for tenant."""
    return shared_subjects.build_subject(bootstrap_settings.TENANT_ID, action)


class AgentCache:
    """Simple cache for agent data."""

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}

    def get(self, agent_id: str) -> dict[str, Any] | None:
        return self._cache.get(agent_id)

    def set(self, agent_id: str, data: dict[str, Any]) -> None:
        self._cache[agent_id] = data

    def delete(self, agent_id: str) -> bool:
        if agent_id in self._cache:
            del self._cache[agent_id]
            return True
        return False

    def size(self) -> int:
        return len(self._cache)


async def handle_agent_published(
    message: Msg,
    data: dict[str, Any],
    _envelope: dict[str, Any],
    cache: AgentCache,
) -> None:
    """Handle agent published events from admin-service."""
    subject = build_subject("agent_published")

    with TracedNatsHandler(
        _tracer, "nats.consume.agent_published", subject, message
    ) as handler:
        try:
            event_payload = data.get("payload", data)
            agent_id = event_payload.get("agentId")
            agent_name = event_payload.get("name")
            published_at = event_payload.get("publishedAt")

            # Update local agent cache
            if agent_id:
                cache.set(
                    agent_id,
                    {
                        "agentId": agent_id,
                        "name": agent_name,
                        "publishedAt": published_at,
                        "data": event_payload,
                    },
                )
                logger.debug(
                    "Cached published agent: %s (%s)",
                    agent_name,
                    agent_id,
                )
                handler.set_attribute("agent.cache.size", cache.size())

                # If full agent config is provided, persist it for runtime
                if event_payload.get("system_prompt"):
                    try:
                        from src.app.agents.agent_manager import get_agent_manager

                        # Build agent config from payload
                        agent_config = _build_agent_config_from_payload(event_payload)

                        # Save to agent store
                        agent_manager = get_agent_manager()
                        await agent_manager.update_agent_config(
                            agent_config,
                            agent_id,
                        )

                        logger.info(
                            "Persisted agent config for published agent: %s (%s)",
                            agent_name,
                            agent_id,
                        )
                    except Exception as config_error:
                        logger.warning(
                            "Failed to persist agent config for %s: %s",
                            agent_id,
                            config_error,
                        )
                        # Don't fail the entire handler, just log warning

            logger.info(
                "Agent published: %s (%s) at %s",
                agent_name,
                agent_id,
                published_at,
            )
        except Exception as error:
            logger.exception("Failed to handle agent published event: %s", error)
            raise


def _extract_llm_from_model_config(model_config: dict[str, Any]) -> dict[str, Any]:
    """Build the ``llm`` dict from admin ``model_config``.

    Aligns with admin-console ``getAgentLlmConfig``: prefer non-empty nested
    ``model_config.llm``; otherwise read provider/model/credentials from the
    root (legacy flat shape).
    """
    nested = model_config.get("llm")
    if isinstance(nested, dict) and nested:
        source: dict[str, Any] = nested
    else:
        source = model_config

    credential_profile_id = source.get(
        "credential_profile_id", source.get("credentialProfileId")
    )
    credential_id = source.get(
        "credentialId",
        source.get("credential_id", credential_profile_id),
    )
    credential_mode = source.get(
        "credentialMode", source.get("credential_mode")
    )
    connector_id = source.get("connectorId", source.get("connector_id"))

    if credential_mode is None:
        credential_mode = "profile" if credential_id else "runtime-default"

    return {
        "provider": source.get("provider"),
        "model": source.get("model"),
        "credential_mode": credential_mode,
        "credential_id": credential_id,
        "connector_id": connector_id,
    }


def _build_agent_config_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Build a runtime agent config from published agent payload."""
    system_prompt = payload.get("system_prompt", "")
    model_config = payload.get("model_config", {})
    tools = payload.get("tools", [])

    normalized_tools = _normalize_tools(tools)
    normalized_skills = _extract_skills(payload)
    rules = _extract_rules(model_config)
    response_style = _extract_response_style(model_config)

    # Build role structure expected by agent config
    role = {
        "name": payload.get("name", "Agent"),
        "description": payload.get("description", ""),
        "system_prompt": system_prompt,
    }

    llm: dict[str, Any] = {}
    if isinstance(model_config, dict):
        llm = _extract_llm_from_model_config(model_config)

    return {
        "name": payload.get("name", "Agent"),
        "description": payload.get("description", ""),
        "role": role,
        "llm": llm,
        "tools": normalized_tools,
        "skills": normalized_skills,
        "rules": rules,
        "response_style": response_style,
    }


def _extract_response_style(model_config: Any) -> str:
    if not isinstance(model_config, dict):
        return ""

    value = model_config.get("soul")
    if not isinstance(value, str):
        return ""
    return value.strip()


def _extract_rules(model_config: Any) -> list[str]:
    if not isinstance(model_config, dict):
        return []

    raw_rules = model_config.get("rules")
    if isinstance(raw_rules, list):
        rules = [str(item).strip() for item in raw_rules if str(item).strip()]
        return rules

    if isinstance(raw_rules, str):
        lines = []
        for line in raw_rules.splitlines():
            cleaned = re.sub(r"^\s*\d+[.)-]?\s*", "", line).strip(" -\t")
            if cleaned:
                lines.append(cleaned)

        if lines:
            return lines

        cleaned_rules = raw_rules.strip()
        return [cleaned_rules] if cleaned_rules else []

    return []


def _extract_skills(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidate_skills = payload.get("skills")

    if not isinstance(candidate_skills, list) or not candidate_skills:
        model_config = payload.get("model_config")
        if isinstance(model_config, dict):
            subagents = model_config.get("subagents")
            if isinstance(subagents, list):
                candidate_skills = subagents

    if not isinstance(candidate_skills, list) or not candidate_skills:
        return []

    normalized_skills: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for index, raw_skill in enumerate(candidate_skills):
        if not isinstance(raw_skill, dict):
            continue

        name = str(raw_skill.get("name", "")).strip()
        if not name:
            continue

        base_id = str(raw_skill.get("id", "")).strip() or _slugify_identifier(
            name,
            f"skill-{index + 1}",
        )
        skill_id = base_id
        suffix = 2
        while skill_id in used_ids:
            skill_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(skill_id)

        description = str(raw_skill.get("description", "")).strip() or (
            f"Skill '{name}'"
        )
        instructions = str(raw_skill.get("instructions", "")).strip()
        if not instructions:
            instructions = str(raw_skill.get("system_prompt", "")).strip()

        allowed_tools_raw = raw_skill.get("allowed_tools")
        if not isinstance(allowed_tools_raw, list):
            allowed_tools_raw = raw_skill.get("allowedTools")

        allowed_tools: list[str] = []
        if isinstance(allowed_tools_raw, list):
            for raw_tool_name in allowed_tools_raw:
                if not isinstance(raw_tool_name, str):
                    continue
                tool_name = raw_tool_name.strip()
                if tool_name and tool_name not in allowed_tools:
                    allowed_tools.append(tool_name)

        raw_config = raw_skill.get("config")
        skill_config = raw_config if isinstance(raw_config, dict) else {}

        normalized_skills.append(
            {
                "id": skill_id,
                "name": name,
                "description": description,
                "enabled": raw_skill.get("enabled", True) is not False,
                "instructions": instructions,
                "allowedTools": allowed_tools,
                "config": skill_config,
            }
        )

    return normalized_skills


def _normalize_tools(raw_tools: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_tools, list):
        return []

    normalized_tools: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for index, raw_tool in enumerate(raw_tools):
        if not isinstance(raw_tool, dict):
            continue

        name = str(raw_tool.get("name", "")).strip()
        if not name:
            continue

        endpoint = str(raw_tool.get("endpoint", "")).strip()
        adapter_ref = raw_tool.get("adapterRef")
        if not endpoint and not isinstance(adapter_ref, dict):
            continue

        base_id = str(raw_tool.get("id", "")).strip() or _slugify_identifier(
            name,
            f"tool-{index + 1}",
        )
        tool_id = base_id
        suffix = 2
        while tool_id in used_ids:
            tool_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(tool_id)

        normalized_tool: dict[str, Any] = {
            "id": tool_id,
            "name": name,
            "enabled": raw_tool.get("enabled", True) is not False,
        }

        method = str(raw_tool.get("method", "POST")).upper().strip()
        if method in {"GET", "POST", "PUT", "DELETE"}:
            normalized_tool["method"] = method
        else:
            normalized_tool["method"] = "POST"

        if endpoint:
            normalized_tool["endpoint"] = endpoint

        if isinstance(adapter_ref, dict):
            normalized_tool["adapterRef"] = adapter_ref

        headers = raw_tool.get("headers")
        if isinstance(headers, dict):
            normalized_tool["headers"] = headers

        body_template = raw_tool.get("bodyTemplate")
        if body_template is None:
            body_template = raw_tool.get("body_template")
        if isinstance(body_template, dict):
            normalized_tool["bodyTemplate"] = body_template

        description = raw_tool.get("description")
        if isinstance(description, str) and description.strip():
            normalized_tool["description"] = description.strip()

        field_descriptions = raw_tool.get("fieldDescriptions")
        if not isinstance(field_descriptions, dict):
            field_descriptions = raw_tool.get("field_descriptions")
        if isinstance(field_descriptions, dict):
            normalized_tool["fieldDescriptions"] = field_descriptions

        normalized_tools.append(normalized_tool)

    return normalized_tools


def _slugify_identifier(value: str, fallback: str) -> str:
    normalized = _IDENTIFIER_SANITIZER.sub("-", value.strip().lower()).strip("-")
    return normalized or fallback


async def handle_agent_unpublished(
    message: Msg,
    data: dict[str, Any],
    _envelope: dict[str, Any],
    cache: AgentCache,
) -> None:
    """Handle agent unpublished events from admin-service."""
    subject = build_subject("agent_unpublished")

    with TracedNatsHandler(
        _tracer, "nats.consume.agent_unpublished", subject, message
    ) as handler:
        try:
            event_payload = data.get("payload", data)
            agent_id = event_payload.get("agentId")
            agent_name = event_payload.get("name")

            # Remove from local agent cache
            if cache.delete(agent_id):
                logger.debug(
                    "Removed unpublished agent from cache: %s (%s)",
                    agent_name,
                    agent_id,
                )
                handler.set_attribute("agent.cache.size", cache.size())

            logger.info(
                "Agent unpublished: %s (%s)",
                agent_name,
                agent_id,
            )
        except Exception as error:
            logger.exception("Failed to handle agent unpublished event: %s", error)
            raise
