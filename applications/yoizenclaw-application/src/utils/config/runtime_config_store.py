"""Runtime configuration store and data models.

Centralizes all configuration-related data classes and the thread-safe
store used by NATS bridge and other services.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable

from src.utils.errors.base import (
    ConfigurationError as _BaseConfigurationError,
    RuntimeNotConfiguredError as _BaseRuntimeNotConfiguredError,
)


class ConfigurationError(_BaseConfigurationError):
    """Raised when configuration from backend is invalid."""


class RuntimeNotConfiguredError(_BaseRuntimeNotConfiguredError):
    """Raised when runtime is accessed before receiving configuration."""


class RequiredFieldMissingError(ConfigurationError):
    """Raised when a required configuration field is missing."""

    def __init__(self, field: str) -> None:
        super().__init__(
            f"Required configuration field '{field}' is missing. "
            "Backend must sync this to the runtime configuration.",
        )


@dataclass
class AgentPersonality:
    """Personality configuration from backend."""

    system_prompt: str
    response_style: str
    tone: str
    rules: list[str]


@dataclass
class LLMConfig:
    """LLM configuration from backend."""

    provider: str
    model: str
    credential_mode: str
    credential_id: str
    temperature: float
    max_tokens: int


@dataclass
class RuntimeConfiguration:
    """Complete runtime configuration from backend."""

    agent: AgentPersonality
    llm: LLMConfig
    prompts: dict[str, str]
    tools: list[dict[str, Any]]
    intervals: dict[str, int]


logger = logging.getLogger(__name__)


class RuntimeConfigStore:
    """Thread-safe store for runtime configuration received from backend."""

    _config: RuntimeConfiguration | None = None
    _lock: asyncio.Lock | None = None
    _listeners: list[Callable[[RuntimeConfiguration], None]] = []

    @classmethod
    def _get_lock(cls) -> asyncio.Lock:
        if cls._lock is None:
            cls._lock = asyncio.Lock()
        return cls._lock

    @classmethod
    async def get(cls) -> RuntimeConfiguration:
        """Get current runtime configuration."""
        if cls._config is None:
            raise RuntimeNotConfiguredError(
                "Runtime not configured. Wait for backend configuration sync.",
            )
        return cls._config

    @classmethod
    def get_optional(cls) -> RuntimeConfiguration | None:
        """Get current runtime configuration if available, None otherwise."""
        return cls._config

    @classmethod
    async def update(cls, config_dict: dict[str, Any]) -> None:
        """Update runtime configuration from dictionary."""
        validated = cls._validate_config(config_dict)

        async with cls._get_lock():
            cls._config = validated

        for listener in cls._listeners:
            try:
                if asyncio.iscoroutinefunction(listener):
                    asyncio.create_task(listener(validated))
                else:
                    asyncio.get_event_loop().run_in_executor(
                        None, listener, validated,
                    )
            except Exception as e:
                logger.error("Error notifying config listener: %s", e)

        logger.info("Runtime configuration updated successfully")

    @classmethod
    def add_listener(
        cls,
        listener: Callable[[RuntimeConfiguration], None],
    ) -> None:
        """Add a listener to be called when configuration is updated."""
        cls._listeners.append(listener)

    @classmethod
    def remove_listener(
        cls,
        listener: Callable[[RuntimeConfiguration], None],
    ) -> None:
        """Remove a configuration update listener."""
        if listener in cls._listeners:
            cls._listeners.remove(listener)

    @classmethod
    def _validate_config(cls, config: dict[str, Any]) -> RuntimeConfiguration:
        """Validate configuration dictionary and create RuntimeConfiguration."""
        agent_config = config.get("agent")
        if not agent_config:
            raise RequiredFieldMissingError("agent")

        system_prompt = agent_config.get("system_prompt") or agent_config.get(
            "systemPrompt",
        )
        if not system_prompt:
            raise RequiredFieldMissingError("agent.system_prompt")

        agent = AgentPersonality(
            system_prompt=system_prompt,
            response_style=agent_config.get("response_style", "")
            or agent_config.get("responseStyle", ""),
            tone=agent_config.get("tone", "professional"),
            rules=agent_config.get("rules", [])
            if isinstance(agent_config.get("rules"), list)
            else [],
        )

        llm_config = config.get("llm")
        if not llm_config:
            raise RequiredFieldMissingError("llm")

        provider = llm_config.get("provider")
        if not provider:
            raise RequiredFieldMissingError("llm.provider")

        model = llm_config.get("model")
        if not model:
            raise RequiredFieldMissingError("llm.model")

        llm = LLMConfig(
            provider=provider,
            model=model,
            credential_mode=llm_config.get("credential_mode", "")
            or llm_config.get("credentialMode", "")
            or (
                "profile"
                if (
                    llm_config.get("credential_id")
                    or llm_config.get("credentialId")
                )
                else "runtime-default"
            ),
            credential_id=llm_config.get("credential_id", "")
            or llm_config.get("credentialId", ""),
            temperature=float(llm_config.get("temperature", 0.7)),
            max_tokens=int(llm_config.get("max_tokens", 2048)),
        )

        prompts = config.get("prompts", {})
        tools = config.get("tools", [])
        intervals = config.get("intervals", {})

        return RuntimeConfiguration(
            agent=agent,
            llm=llm,
            prompts=prompts if isinstance(prompts, dict) else {},
            tools=tools if isinstance(tools, list) else [],
            intervals=intervals if isinstance(intervals, dict) else {},
        )

    @classmethod
    def clear(cls) -> None:
        """Clear the current configuration. Used for testing."""
        cls._config = None
