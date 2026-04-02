"""Provider-aware LLM client used by the runtime.

Supports per-agent provider and model selection, resolves credential bundles
from environment variables. All provider and model configuration comes from
backend via NATS - no hardcoded defaults.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Sequence

from pydantic_ai import Agent as PydanticAgent, RunContext
from pydantic_ai.output import StructuredDict
from pydantic import BaseModel
from opentelemetry import trace

from src.shared.config.prompts import PromptLoadError, PromptLoader
from src.shared.errors import RequiredFieldMissingError
from src.application.llm.credentials import (
    _has_provider_credentials,
    _normalize_credential_id,
    _normalize_credential_mode,
    _normalize_model,
    _normalize_provider,
    _resolve_credentials,
)
from src.shared.telemetry import get_tracer, record_llm_call, record_llm_tokens
from src.tools.registry import ToolRegistry
from src.shared.config.settings import bootstrap_settings

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

    @classmethod
    def _get_cache_key(
        cls,
        model_identifier: str,
        instructions_hash: str,
        tools_count: int,
    ) -> str:
        """Generate cache key from agent configuration components."""
        return f"{model_identifier}:{instructions_hash}:{tools_count}"

    @classmethod
    def create_agent(
        cls,
        model_identifier: str,
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
        return agent

    @classmethod
    def _register_tool(cls, agent: PydanticAgent, tool_def: dict[str, Any]) -> None:
        """Register a tool with the agent using decorator pattern.

        This enables tool functions to access RunContext for dependencies.
        """
        tool_name = tool_def.get("name")
        if not tool_name:
            return

        # Store tool definition for use in decorator
        _tool_registry[tool_name] = tool_def

        @agent.tool
        async def dynamic_tool(ctx: RunContext[LLMDeps], **kwargs: Any) -> str:
            """Dynamic tool wrapper with dependency injection."""
            tool_config = _tool_registry.get(tool_name, {})

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

    @classmethod
    def get_cache_stats(cls) -> dict[str, int]:
        """Get cache statistics for monitoring."""
        return {
            "cached_agents": len(cls._cache),
            "cache_keys": len(cls._cache),
        }


# Tool registry for dynamic tool resolution
_tool_registry: dict[str, dict[str, Any]] = {}


class LLMClient:
    """LLM client configured entirely by backend.

    All provider and model configuration comes from RuntimeConfigStore
    (populated by backend via NATS) - no hardcoded defaults.
    """

    def __init__(self, llm_config: dict[str, object] | None = None) -> None:
        """Initialize the LLM client based on backend configuration.

        If llm_config is provided, it is used directly. Otherwise,
        configuration is fetched from RuntimeConfigStore.
        """
        if llm_config:
            config = llm_config
        else:
            from src.shared.config.runtime_config_store import RuntimeConfigStore

            runtime_config = RuntimeConfigStore.get_optional()
            if runtime_config is None:
                raise RequiredFieldMissingError(
                    "llm configuration not received from backend"
                )
            config = {
                "provider": runtime_config.llm.provider,
                "model": runtime_config.llm.model,
                "credential_id": runtime_config.llm.credential_id,
                "credential_mode": getattr(
                    runtime_config.llm,
                    "credential_mode",
                    None,
                ),
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
        self.credentials = _resolve_credentials(
            self.provider,
            self.credential_id,
            self.credential_mode,
        )
        self.api_key = self.credentials.api_key
        self._use_mock = not _has_provider_credentials(
            self.provider, self.credentials
        )
        self._model: object | None = None
        self._prompt_loader = PromptLoader()

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

            latest_message = prompt[marker_index + len(marker):].strip().splitlines()[0]
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
        model_id = self._get_model_identifier()

        agent = LLMAgentFactory.create_agent(
            model_identifier=model_id,
            instructions=instructions,
            deps_type=LLMDeps,
        )

        result = await agent.run(
            prompt,
            deps=deps or LLMDeps(
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

        from src.infrastructure.llm_providers.providers import provider_registry

        self._model = provider_registry.create_provider(
            provider=self.provider,
            model=self.model,
            credentials=self.credentials,
        )
        return self._model

    def supports_tool_execution(self) -> bool:
        return not self._use_mock

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

        model_id = self._get_model_identifier()

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

        model_id = self._get_model_identifier()

        # Create dynamic Pydantic model from schema for output_type
        output_model = create_model(
            "RuntimeStructuredOutput",
            **{
                k: (Any, ...)
                for k in output_schema.get("properties", {}).keys()
            },
        )

        agent = LLMAgentFactory.create_agent(
            model_identifier=model_id,
            instructions=instructions,
            deps_type=LLMDeps,
        )

        result = await agent.run(
            prompt,
            deps=deps or LLMDeps(
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

    def _parse_structured_json_response(
        self,
        response_text: str,
    ) -> dict[str, Any]:
        raw_json = response_text.strip()
        code_block = re.search(
            r"```(?:json)?\s*(.*?)\s*```",
            raw_json,
            re.DOTALL | re.IGNORECASE,
        )
        if code_block is not None:
            raw_json = code_block.group(1).strip()

        parsed = json.loads(raw_json)
        if not isinstance(parsed, dict):
            raise ValueError("Structured LLM responses must be JSON objects")
        return parsed

    async def generate_structured(
        self,
        prompt: str,
        output_schema: dict[str, Any],
        instructions: str | None = None,
        deps: LLMDeps | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON output from the LLM with instrumentation."""
        prompt_tokens = len(prompt.split())

        with _tracer.start_as_current_span("llm.generate_structured") as span:
            span.set_attribute("llm.model", self.model)
            span.set_attribute("llm.provider", self.provider)
            span.set_attribute("llm.prompt.tokens", prompt_tokens)
            span.set_attribute("llm.output_schema.properties_count", len(output_schema.get("properties", {})))
            if instructions:
                span.set_attribute("llm.instructions.length", len(instructions))

            start_time = time.time()

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

                duration = time.time() - start_time
                duration_ms = duration * 1000

                # Estimate tokens from result
                result_json = json.dumps(result)
                output_tokens = len(result_json.split())
                total_tokens = prompt_tokens + output_tokens

                # Record metrics
                record_llm_call(self.model, "success")
                record_llm_tokens(prompt_tokens, self.model, "input")
                record_llm_tokens(output_tokens, self.model, "output")

                # Set span attributes
                span.set_attribute("llm.response.tokens", output_tokens)
                span.set_attribute("llm.total_tokens", total_tokens)
                span.set_attribute("llm.latency_ms", duration_ms)
                span.set_attribute("llm.response.size_bytes", len(result_json))
                span.set_status(trace.StatusCode.OK)

                return result

            except Exception as e:
                duration = time.time() - start_time

                # Record metrics for error
                record_llm_call(self.model, "error")

                span.record_exception(e)
                span.set_attribute("llm.latency_ms", duration * 1000)
                span.set_status(trace.StatusCode.ERROR, str(e))
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
        prompt_tokens = len(prompt.split())

        with _tracer.start_as_current_span("llm.generate") as span:
            span.set_attribute("llm.model", self.model)
            span.set_attribute("llm.provider", self.provider)
            span.set_attribute("llm.prompt.tokens", prompt_tokens)
            if instructions:
                span.set_attribute("llm.instructions.length", len(instructions))

            start_time = time.time()

            try:
                if self._use_mock:
                    response = self._generate_mock(prompt)
                else:
                    response = await self._generate_pydantic_ai(
                        prompt,
                        instructions=instructions,
                        deps=deps,
                    )

                duration = time.time() - start_time
                duration_ms = duration * 1000

                # Estimate output tokens from response content
                output_tokens = len(response.content.split()) if response.content else 0
                total_tokens = prompt_tokens + output_tokens

                # Record metrics
                record_llm_call(self.model, "success")
                record_llm_tokens(prompt_tokens, self.model, "input")
                record_llm_tokens(output_tokens, self.model, "output")

                # Set span attributes
                span.set_attribute("llm.response.tokens", output_tokens)
                span.set_attribute("llm.total_tokens", total_tokens)
                span.set_attribute("llm.latency_ms", duration_ms)
                span.set_attribute("llm.response.length", len(response.content))
                span.set_status(trace.StatusCode.OK)

                return response

            except Exception as e:
                duration = time.time() - start_time

                # Record metrics for error
                record_llm_call(self.model, "error")

                span.record_exception(e)
                span.set_attribute("llm.latency_ms", duration * 1000)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise
