"""Provider-aware LLM client used by the runtime.

Supports per-agent provider and model selection, resolves credential bundles
from environment variables. All provider and model configuration comes from
backend via NATS - no hardcoded defaults.
"""

from __future__ import annotations

import json
import logging
import os
import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from pydantic_ai import Agent as PydanticAgent, RunContext
from pydantic import BaseModel
from opentelemetry import trace

from src.utils.config.prompts import PromptLoadError, PromptLoader
from src.utils.errors import RequiredFieldMissingError
from src.app.llm.credentials import (
    _has_provider_credentials,
    _normalize_credential_id,
    _normalize_credential_mode,
    _normalize_model,
    _normalize_provider,
    _resolve_credentials,
    resolve_from_adapter,
)
from src.utils.telemetry import get_tracer, record_llm_call, record_llm_tokens
from src.utils.utils.credentials import CredentialSettings
from src.app.tools.registry import ToolRegistry
from src.app.llm._instrumentation import InstrumentedLLMGenerate
from src.utils.config.settings import bootstrap_settings

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


@dataclass(frozen=True)
class LLMDeps:
    """Dependencies for LLM agent execution via pydantic-ai RunContext.

    All values sourced from RuntimeConfigStore or environment configuration.
    """

    tenant_id: str
    agent_id: str
    conversation_id: str | None = None
    tool_registry: ToolRegistry | None = None
    metadata: dict[str, Any] | None = None


class LLMResponse(BaseModel):
    """Structured response from the LLM."""

    content: str
    model: str
    provider: str


class LLMAgentFactory:
    """Factory for creating and caching pydantic-ai Agent instances.

    Follows pydantic-ai best practices:
    - Uses model identifier strings from configuration
    - Caches agents by composite key for reuse
    - Uses instructions decorator instead of system_prompt
    - Supports dynamic tool registration with dependency injection
    """

    _cache: dict[str, PydanticAgent] = {}
    _max_cache_size = 100

    @classmethod
    def _get_cache_key(
        cls,
        model_identifier: str | object,
        instructions_hash: str,
        tools_count: int,
    ) -> str:
        """Generate cache key from agent configuration components."""
        if isinstance(model_identifier, str):
            model_key = model_identifier
        else:
            model_key = f"model_obj:{id(model_identifier)}"
        return f"{model_key}:{instructions_hash}:{tools_count}"

    @classmethod
    def create_agent(
        cls,
        model_identifier: str | object,
        instructions: str | None = None,
        tools: Sequence[Any] = (),
        deps_type: type | None = None,
    ) -> PydanticAgent:
        """Create or retrieve a cached pydantic-ai Agent.

        Args:
            model_identifier: Provider:model string from RuntimeConfigStore.
            instructions: Static instructions for the agent.
            tools: Sequence of tool definitions.
            deps_type: Type for dependency injection via RunContext.

        Returns:
            Configured PydanticAgent instance (cached if same config).
        """
        import hashlib

        instructions_hash = (
            hashlib.md5(instructions.encode()).hexdigest()[:8]
            if instructions
            else "none"
        )
        cache_key = cls._get_cache_key(
            model_identifier,
            instructions_hash,
            len(tools),
        )

        if cache_key in cls._cache:
            logger.debug("Reusing cached agent for key: %s", cache_key)
            return cls._cache[cache_key]

        logger.debug("Creating new agent for key: %s", cache_key)

        agent_kwargs: dict[str, Any] = {}

        if instructions:
            agent_kwargs["instructions"] = instructions

        if deps_type:
            agent_kwargs["deps_type"] = deps_type

        agent = PydanticAgent(
            model_identifier,
            **agent_kwargs,
        )

        # Register tools via decorator pattern for dependency access
        if tools:
            for tool_def in tools:
                cls._register_tool(agent, tool_def)

        cls._cache[cache_key] = agent
        
        # Simple LRU eviction: remove oldest entry if cache is full
        if len(cls._cache) > cls._max_cache_size:
            oldest_key = next(iter(cls._cache))
            del cls._cache[oldest_key]
            
        return agent

    @classmethod
    def _register_tool(cls, agent: PydanticAgent, tool_def: dict[str, Any]) -> None:
        """Register a tool with the agent using decorator pattern.

        This enables tool functions to access RunContext for dependencies.
        """
        tool_name = tool_def.get("name")
        if not tool_name:
            return

        @agent.tool
        async def dynamic_tool(ctx: RunContext[LLMDeps], **kwargs: Any) -> str:
            """Dynamic tool wrapper with dependency injection."""
            # Access tool registry from dependencies if available
            if ctx.deps.tool_registry:
                actual_tool = ctx.deps.tool_registry.get_tool(tool_name)
                if actual_tool:
                    return await actual_tool.execute(**kwargs)

            # Fallback: return tool configuration
            return f"Tool {tool_name} executed with {kwargs}"

    @classmethod
    def clear_cache(cls) -> None:
        """Clear the agent cache. Useful for testing or config reloads."""
        cls._cache.clear()
        logger.info("LLM agent cache cleared")


class LLMClient:
    """LLM client configured entirely by backend.

    All provider and model configuration comes from RuntimeConfigStore
    (populated by backend via NATS) - no hardcoded defaults.
    """

    def __init__(self, llm_config: dict[str, object] | None = None) -> None:
        if llm_config:
            config = llm_config
        else:
            from src.utils.config.runtime_config_store import RuntimeConfigStore

            runtime_config = RuntimeConfigStore.get_optional()
            if runtime_config is None:
                raise RequiredFieldMissingError(
                    "llm configuration not received from backend"
                )
            rc_llm = runtime_config.llm
            config = {
                "provider": rc_llm.provider,
                "model": rc_llm.model,
                "credential_id": rc_llm.credential_id,
                "credential_mode": getattr(rc_llm, "credential_mode", None),
                "connector_id": getattr(rc_llm, "connector_id", "") or "",
            }

        self.provider = _normalize_provider(config.get("provider"))
        self.model = _normalize_model(config.get("model"))
        self.credential_id = _normalize_credential_id(
            config.get("credential_id", config.get("credentialId"))
        )
        self.credential_mode = _normalize_credential_mode(
            config.get("credential_mode", config.get("credentialMode")),
            self.credential_id,
        )

        self._connector_id: str | None = None
        raw_connector = config.get("connector_id", config.get("connectorId"))
        if isinstance(raw_connector, str):
            stripped = raw_connector.strip()
            # Adapter IDs may be UUIDs or opaque strings from adapter-service / admin UI
            if stripped and len(stripped) <= 256:
                self._connector_id = stripped

        if self._connector_id is not None:
            self.credentials = CredentialSettings()
            self._credentials_resolved = False
        else:
            self.credentials = _resolve_credentials(
                self.provider,
                self.credential_id,
                self.credential_mode,
            )
            self._credentials_resolved = True

        self.api_key = self.credentials.api_key
        # Fix mock mode logic: use mock when credentials are not available
        if self._connector_id is not None:
            # Connector-based credentials - use mock until resolved
            self._use_mock = not self._credentials_resolved
        else:
            # Traditional credentials - use mock when provider credentials are missing
            self._use_mock = not _has_provider_credentials(self.provider, self.credentials)
        self._model: object | None = None
        self._prompt_loader = PromptLoader()
        self._credentials_lock = asyncio.Lock()

    async def _ensure_credentials(self) -> None:
        # Simple lock-based resolution - no race conditions
        if self._credentials_resolved:
            return

        async with self._credentials_lock:
            if self._credentials_resolved:
                return

            try:
                if self._connector_id is None:
                    self.credentials = _resolve_credentials(
                        self.provider,
                        self.credential_id,
                        self.credential_mode,
                    )
                    self.api_key = self.credentials.api_key
                    self._use_mock = not _has_provider_credentials(
                        self.provider, self.credentials
                    )
                else:
                    from src.utils.adapter_client import ensure_adapter_client_in_container

                    adapter_client = ensure_adapter_client_in_container()
                    if adapter_client is None:
                        raise RuntimeError(
                            "AdapterClient is not available: set ADAPTER_SERVICE_URL "
                            "and TENANT_ID so the runtime can fetch adapter credentials "
                            f"(connector_id={self._connector_id!r}).",
                        )

                    self.credentials = await resolve_from_adapter(
                        adapter_client,
                        self._connector_id,
                    )
                    self.api_key = self.credentials.api_key
                    self._use_mock = not _has_provider_credentials(
                        self.provider, self.credentials
                    )

                # Mark as resolved only after success
                self._credentials_resolved = True
                # Invalidate model cache only after successful resolution
                self._model = None
                
            except Exception:
                # Reset state on failure to allow retry
                self._credentials_resolved = False
                raise

    def _get_model_identifier(self) -> str:
        """Build model identifier string from configuration.

        Returns:
            Provider:model string compatible with pydantic-ai.
        """
        return f"{self.provider}:{self.model}"

    def _generate_mock(self, prompt: str) -> LLMResponse:
        """Generate a mock response when no API key is available.

        Args:
            prompt: The input prompt for the LLM.

        Returns:
            A mock response indicating the system is in demo mode.
        """
        latest_message = ""
        for marker in ("Latest customer message:", "User:"):
            marker_index = prompt.rfind(marker)
            if marker_index == -1:
                continue

            latest_message = (
                prompt[marker_index + len(marker) :].strip().splitlines()[0]
            )
            if latest_message:
                break

        try:
            content = self._prompt_loader.render(
                "user/mock_llm_response",
                message=latest_message or prompt.strip(),
            ).strip()
        except PromptLoadError:
            content = (
                f'I received "{latest_message or prompt.strip()}" '
                "and I am ready to keep helping."
            )

        return LLMResponse(
            content=content,
            model=self.model,
            provider="mock",
        )

    async def _generate_pydantic_ai(
        self,
        prompt: str,
        instructions: str | None = None,
        deps: LLMDeps | None = None,
    ) -> LLMResponse:
        """Generate response using cached pydantic-ai Agent with RunContext.

        Args:
            prompt: The user prompt.
            instructions: Optional instructions (replaces system_prompt).
            deps: Dependencies for RunContext injection.

        Returns:
            LLMResponse with generated content.
        """
        model_id = self._get_pydantic_model()

        agent = LLMAgentFactory.create_agent(
            model_identifier=model_id,
            instructions=instructions,
            deps_type=LLMDeps,
        )

        result = await agent.run(
            prompt,
            deps=deps
            or LLMDeps(
                tenant_id=bootstrap_settings.TENANT_ID or "default",
                agent_id="llm-client",
            ),
        )

        return LLMResponse(
            content=result.output,
            model=self.model,
            provider=self.provider,
        )

    def _get_pydantic_model(self) -> object:
        """Get or create the pydantic-ai model instance.

        Uses provider registry to eliminate repetitive if/elif chains.

        Returns:
            Configured pydantic-ai model instance.

        Raises:
            RuntimeError: If provider not supported.
        """
        if self._model is not None:
            return self._model

        from src.infra.llm_providers.providers import provider_registry

        self._model = provider_registry.create_provider(
            provider=self.provider,
            model=self.model,
            credentials=self.credentials,
        )
        return self._model

    def supports_tool_execution(self) -> bool:
        return not self._use_mock

    def _register_tool(self, agent: PydanticAgent, tool_def: Any) -> None:
        """Backwards-compatible tool registration helper for runtime agents."""
        LLMAgentFactory._register_tool(agent, tool_def)

    def build_text_agent(
        self,
        instructions: str | None = None,
        tools: Sequence[Any] = (),
    ) -> PydanticAgent:
        """Build a pydantic-ai Agent with caching and dependency injection.

        Args:
            instructions: Instructions for the agent (replaces system_prompt).
            tools: Tools to register with the agent.

        Returns:
            Configured PydanticAgent instance.
        """
        if not self.supports_tool_execution():
            raise RuntimeError(
                f"Provider '{self.provider}' does not support native tool execution",
            )

        model_id = self._get_pydantic_model()

        return LLMAgentFactory.create_agent(
            model_identifier=model_id,
            instructions=instructions,
            tools=tools,
            deps_type=LLMDeps,
        )

    async def _generate_pydantic_ai_structured(
        self,
        prompt: str,
        output_schema: dict[str, Any],
        instructions: str | None = None,
        deps: LLMDeps | None = None,
    ) -> dict[str, Any]:
        """Generate structured response using cached agent with RunContext.

        Args:
            prompt: The user prompt.
            output_schema: JSON schema for structured output.
            instructions: Optional instructions for the agent.
            deps: Dependencies for RunContext injection.

        Returns:
            Structured output as dictionary.
        """
        from pydantic import create_model

        model_id = self._get_pydantic_model()

        # Create dynamic Pydantic model from schema for output_type
        output_model = create_model(
            "RuntimeStructuredOutput",
            **{k: (Any, ...) for k in output_schema.get("properties", {}).keys()},
        )

        agent = LLMAgentFactory.create_agent(
            model_identifier=model_id,
            instructions=instructions,
            deps_type=LLMDeps,
        )

        result = await agent.run(
            prompt,
            deps=deps
            or LLMDeps(
                tenant_id=bootstrap_settings.TENANT_ID or "default",
                agent_id="llm-client-structured",
            ),
            output_type=output_model,
        )

        if not isinstance(result.output, dict):
            raise ValueError("Structured LLM responses must be JSON objects")
        return result.output

    def _generate_mock_structured(
        self,
        output_schema: dict[str, Any],
    ) -> dict[str, Any]:
        properties = output_schema.get("properties")
        if not isinstance(properties, dict):
            return {}

        structured_output: dict[str, Any] = {}
        for key, property_schema in properties.items():
            if not isinstance(property_schema, dict):
                structured_output[key] = None
                continue

            if "default" in property_schema:
                structured_output[key] = property_schema["default"]
                continue

            property_type = property_schema.get("type")
            if property_type == "boolean":
                structured_output[key] = False
            elif property_type in {"integer", "number"}:
                structured_output[key] = 0
            elif property_type == "array":
                structured_output[key] = []
            elif property_type == "object":
                structured_output[key] = {}
            elif property_type == "string":
                structured_output[key] = ""
            else:
                structured_output[key] = None

        return structured_output

    async def generate_structured(
        self,
        prompt: str,
        output_schema: dict[str, Any],
        instructions: str | None = None,
        deps: LLMDeps | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON output from the LLM with instrumentation."""
        await self._ensure_credentials()
        prompt_tokens = len(prompt.split())

        with InstrumentedLLMGenerate(
            tracer=_tracer,
            span_name="llm.generate_structured",
            model=self.model,
            provider=self.provider,
            prompt_tokens=prompt_tokens,
            instructions=instructions,
            output_schema=output_schema,
        ) as instrumented:
            try:
                if self._use_mock:
                    result = self._generate_mock_structured(output_schema)
                else:
                    result = await self._generate_pydantic_ai_structured(
                        prompt,
                        output_schema,
                        instructions=instructions,
                        deps=deps,
                    )

                instrumented.record_output_metrics(result)
                return result
            except Exception:
                # Error already recorded by context manager
                raise

    async def generate(
        self,
        prompt: str,
        instructions: str | None = None,
        deps: LLMDeps | None = None,
    ) -> LLMResponse:
        """Generate a response from the LLM with instrumentation.

        Args:
            prompt: The user message for the LLM.
            instructions: Optional instructions sent to the agent.
            deps: Dependencies for RunContext injection.

        Returns:
            The LLM response with content and metadata.
        """
        await self._ensure_credentials()
        prompt_tokens = len(prompt.split())

        with InstrumentedLLMGenerate(
            tracer=_tracer,
            span_name="llm.generate",
            model=self.model,
            provider=self.provider,
            prompt_tokens=prompt_tokens,
            instructions=instructions,
        ) as instrumented:
            try:
                if self._use_mock:
                    response = self._generate_mock(prompt)
                else:
                    response = await self._generate_pydantic_ai(
                        prompt,
                        instructions=instructions,
                        deps=deps,
                    )

                instrumented.record_output_metrics(response.content)
                return response
            except Exception:
                # Error already recorded by context manager
                raise
