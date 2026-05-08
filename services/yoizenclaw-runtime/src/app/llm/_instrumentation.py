"""LLM instrumentation helpers to eliminate boilerplate code."""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from opentelemetry import trace

from src.utils.telemetry import record_llm_call, record_llm_tokens


class InstrumentedLLMGenerate:
    """Context manager for LLM generation with tracing and metrics."""

    def __init__(
        self,
        tracer: trace.Tracer,
        span_name: str,
        model: str,
        provider: str,
        prompt_tokens: int,
        instructions: str | None = None,
        output_schema: dict[str, Any] | None = None,
    ) -> None:
        self.tracer = tracer
        self.span_name = span_name
        self.model = model
        self.provider = provider
        self.prompt_tokens = prompt_tokens
        self.instructions = instructions
        self.output_schema = output_schema
        self.start_time = time.time()
        self.span = None

    def __enter__(self) -> "InstrumentedLLMGenerate":
        self.span = self.tracer.start_span(self.span_name)

        # Set standard LLM attributes
        self.span.set_attribute("llm.model", self.model)
        self.span.set_attribute("llm.provider", self.provider)
        self.span.set_attribute("llm.prompt.tokens", self.prompt_tokens)

        if self.instructions:
            self.span.set_attribute("llm.instructions.length", len(self.instructions))

        if self.output_schema:
            properties_count = len(self.output_schema.get("properties", {}))
            self.span.set_attribute(
                "llm.output_schema.properties_count", properties_count
            )

        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        duration = time.time() - self.start_time
        duration_ms = duration * 1000

        if exc_type is None:
            # Success case
            record_llm_call(self.model, "success")
            self.span.set_attribute("llm.latency_ms", duration_ms)
            self.span.set_status(trace.StatusCode.OK)
        else:
            # Error case
            record_llm_call(self.model, "error")
            self.span.record_exception(exc_val)
            self.span.set_attribute("llm.latency_ms", duration_ms)
            self.span.set_status(trace.StatusCode.ERROR, str(exc_val))

    def record_output_metrics(self, response_content: str | dict[str, Any]) -> None:
        """Record output-specific metrics after successful generation."""
        if isinstance(response_content, str):
            output_tokens = len(response_content.split()) if response_content else 0
            self.span.set_attribute("llm.response.length", len(response_content))
        else:
            # Structured output
            response_json = json.dumps(response_content)
            output_tokens = len(response_json.split())
            self.span.set_attribute("llm.response.size_bytes", len(response_json))

        total_tokens = self.prompt_tokens + output_tokens

        # Record token metrics
        record_llm_tokens(self.prompt_tokens, self.model, "input")
        record_llm_tokens(output_tokens, self.model, "output")

        # Set span attributes
        self.span.set_attribute("llm.response.tokens", output_tokens)
        self.span.set_attribute("llm.total_tokens", total_tokens)
