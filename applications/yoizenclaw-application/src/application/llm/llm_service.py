"""Provider-aware LLM client used by the runtime.

Supports per-agent provider and model selection, resolves credential bundles
from environment variables. All provider and model configuration comes from
backend via WebSocket - no hardcoded defaults.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Sequence

from pydantic_ai import Agent as PydanticAgent
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

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


class LLMResponse(BaseModel):
    """Structured response from the LLM."""

    content: str
    model: str
    provider: str


class LLMClient:
    """LLM client configured entirely by backend.

    All provider and model configuration comes from RuntimeConfigStore
    (populated by backend via WebSocket) - no hardcoded defaults.
    """

    def __init__(self, llm_config: dict[str, object] | None = None) -> None:
        """Initialize the LLM client based on backend configuration.

        If llm_config is provided, it is used directly. Otherwise,
        configuration is fetched from RuntimeConfigStore.
        """
        if llm_config:
            config = llm_config
        else:
            from src.interfaces.websocket import RuntimeConfigStore

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
        system_prompt: str | Sequence[str] | None = None,
        tools: Sequence[Any] = (),
    ) -> PydanticAgent:
        if not self.supports_tool_execution():
            raise RuntimeError(
                f"Provider '{self.provider}' does not support native tool execution",
            )

        prompt_value: str | Sequence[str]
        if system_prompt is None:
            prompt_value = ()
        else:
            prompt_value = system_prompt

        return PydanticAgent(
            self._get_pydantic_model(),
            system_prompt=prompt_value,
            tools=tools,
        )

    async def _generate_pydantic_ai(
        self,
        prompt: str,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        agent = PydanticAgent(
            self._get_pydantic_model(),
            system_prompt=system_prompt or (),
        )
        result = await agent.run(prompt)
        return LLMResponse(
            content=result.output,
            model=self.model,
            provider=self.provider,
        )

    async def _generate_pydantic_ai_structured(
        self,
        prompt: str,
        output_schema: dict[str, Any],
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        agent = PydanticAgent(
            self._get_pydantic_model(),
            system_prompt=system_prompt or (),
            output_type=StructuredDict(
                output_schema,
                name="RuntimeStructuredOutput",
            ),
        )
        result = await agent.run(prompt)
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
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON output from the LLM with instrumentation."""
        prompt_tokens = len(prompt.split())
        
        with _tracer.start_as_current_span("llm.generate_structured") as span:
            span.set_attribute("llm.model", self.model)
            span.set_attribute("llm.provider", self.provider)
            span.set_attribute("llm.prompt.tokens", prompt_tokens)
            span.set_attribute("llm.output_schema.properties_count", len(output_schema.get("properties", {})))
            if system_prompt:
                span.set_attribute("llm.system_prompt.length", len(system_prompt))
            
            start_time = time.time()
            
            try:
                if self._use_mock:
                    result = self._generate_mock_structured(output_schema)
                else:
                    result = await self._generate_pydantic_ai_structured(
                        prompt,
                        output_schema,
                        system_prompt,
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
        system_prompt: str | None = None,
    ) -> LLMResponse:
        """Generate a response from the LLM with instrumentation.

        Args:
            prompt: The user message for the LLM.
            system_prompt: Optional system prompt sent separately when supported.

        Returns:
            The LLM response with content and metadata.
        """
        prompt_tokens = len(prompt.split())
        
        with _tracer.start_as_current_span("llm.generate") as span:
            span.set_attribute("llm.model", self.model)
            span.set_attribute("llm.provider", self.provider)
            span.set_attribute("llm.prompt.tokens", prompt_tokens)
            if system_prompt:
                span.set_attribute("llm.system_prompt.length", len(system_prompt))
            
            start_time = time.time()
            
            try:
                if self._use_mock:
                    response = self._generate_mock(prompt)
                else:
                    response = await self._generate_pydantic_ai(prompt, system_prompt)
                
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
