"""Handler for agent-related NATS messages."""

from __future__ import annotations

import logging
from typing import Any

from nats.aio.msg import Msg
from opentelemetry import trace

from src.messaging._nats_tracing import TracedNatsHandler
from src.utils.config.settings import bootstrap_settings

import subjects as shared_subjects

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)


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


def _build_agent_config_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Build a runtime agent config from published agent payload."""
    system_prompt = payload.get("system_prompt", "")
    model_config = payload.get("model_config", {})
    tools = payload.get("tools", [])

    # Build role structure expected by agent config
    role = {
        "name": payload.get("name", "Agent"),
        "description": payload.get("description", ""),
        "system_prompt": system_prompt,
    }

    # Build LLM config from model_config
    llm = {}
    if isinstance(model_config, dict):
        credential_profile_id = model_config.get(
            "credential_profile_id", model_config.get("credentialProfileId")
        )
        credential_id = model_config.get(
            "credentialId",
            model_config.get("credential_id", credential_profile_id),
        )
        credential_mode = model_config.get(
            "credentialMode", model_config.get("credential_mode")
        )

        if credential_mode is None:
            credential_mode = "profile" if credential_id else "runtime-default"

        llm["provider"] = model_config.get("provider")
        llm["model"] = model_config.get("model")
        llm["credential_mode"] = credential_mode
        llm["credential_id"] = credential_id

    return {
        "name": payload.get("name", "Agent"),
        "description": payload.get("description", ""),
        "role": role,
        "llm": llm,
        "tools": tools or [],
        "skills": [],
        "rules": [],
        "response_style": "",
    }


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
