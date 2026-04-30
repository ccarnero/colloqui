"""Runtime agent with prompt and skill-based tool execution support.

This module provides the public Agent class that delegates to
specialized sub-modules for template rendering, condition evaluation,
and tool execution.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from pydantic import BaseModel
from pydantic_ai.tools import Tool
from opentelemetry import trace

from src.app.agents.prompt_references import parse_prompt_references
from src.utils.config.prompts import PromptLoader
from src.app.llm.llm_service import LLMClient, LLMDeps
from src.app.agents.condition_evaluator import ConditionEvaluator
from src.app.agents.template_renderer import TemplateRenderer
from src.app.agents.tool_executor import ToolExecutor
from src.app.agents._helpers import normalize_config_items
from src.app.agents._skill_execution import resolve_skill, execute_skill_with_llm
from src.app.tools.registry import ToolRegistry
from src.utils.config.settings import bootstrap_settings
from src.utils.telemetry import get_tracer, record_agent_execution

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


def _extract_run_text(result: Any) -> str:
    """Extract plain text from pydantic-ai run results.

    Newer pydantic-ai versions expose text on ``output`` while older tests or
    mocks may still provide ``content``.
    """
    output_value = getattr(result, "output", None)
    if isinstance(output_value, str):
        return output_value

    content_value = getattr(result, "content", None)
    if isinstance(content_value, str):
        return content_value

    return str(output_value or content_value or "")


class Agent:
    """Runtime agent with optional skill execution.

    Delegates to:
    - ``ToolExecutor`` for tool dispatch.
    - ``TemplateRenderer`` for state variable substitution.
    - ``ConditionEvaluator`` for safe condition evaluation.
    """

    def __init__(
        self,
        system_prompt: str,
        llm_config: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        skills: list[dict[str, Any]] | None = None,
        prompt_loader: PromptLoader | None = None,
        tool_registry: ToolRegistry | None = None,
        agent_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.system_prompt = system_prompt
        self.skills = normalize_config_items(skills)
        self.agent_metadata = self._normalize_mapping(agent_metadata)
        self.llm_client = LLMClient(llm_config)
        self.prompt_loader = prompt_loader or PromptLoader()
        self.tool_registry = tool_registry or ToolRegistry()
        self._condition_evaluator = ConditionEvaluator()
        self._renderer = TemplateRenderer()
        self._tool_executor = ToolExecutor(
            tools=tools or [],
            tool_registry=self.tool_registry,
            prompt_loader=self.prompt_loader,
            template_renderer=self._renderer,
        )

    async def run(
        self,
        user_prompt: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """Run the agent with a user prompt and return plain text."""
        start_time = time.time()
        agent_name = (
            self.agent_metadata.get("name", "unknown")
            if self.agent_metadata
            else "unknown"
        )
        agent_id = (
            self.agent_metadata.get("id", "unknown")
            if self.agent_metadata
            else "unknown"
        )

        with _tracer.start_as_current_span("agent.execute") as span:
            span.set_attribute("agent.id", agent_id)
            span.set_attribute("agent.name", agent_name)
            span.set_attribute("agent.operation", "run")
            span.set_attribute("input.length", len(user_prompt))

            try:
                state = self._build_runtime_state(context, user_prompt)
                rendered_system_prompt = self._render_prompt_sections(
                    self.system_prompt,
                    state,
                    state["warnings"],
                )
                memory_context = self._render_memory_context(state)
                if memory_context:
                    rendered_system_prompt = (
                        f"{rendered_system_prompt}\n\n{memory_context}"
                    ).strip()

                response = await self.llm_client.generate(
                    user_prompt,
                    instructions=rendered_system_prompt,
                    deps=LLMDeps(
                        tenant_id=bootstrap_settings.TENANT_ID or "default",
                        agent_id=agent_id,
                        conversation_id=context.get("conversation_id")
                        if context
                        else None,
                        tool_registry=self.tool_registry,
                        metadata=self.agent_metadata,
                    ),
                )

                # Record metrics
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="success",
                    model=self.llm_client.model,
                )

                response_text = _extract_run_text(response)
                span.set_attribute("output.length", len(response_text))
                span.set_attribute("duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)

                return response_text

            except Exception as e:
                # Record metrics for error
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="error",
                    model=self.llm_client.model,
                )

                span.record_exception(e)
                span.set_attribute("duration_ms", (time.time() - start_time) * 1000)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    async def run_with_skill(
        self,
        user_prompt: str,
        context: dict[str, Any] | None = None,
        skill_name: str | None = None,
    ) -> dict[str, Any]:
        """Run the agent with an optional skill and tool execution."""
        start_time = time.time()
        agent_name = (
            self.agent_metadata.get("name", "unknown")
            if self.agent_metadata
            else "unknown"
        )
        agent_id = (
            self.agent_metadata.get("id", "unknown")
            if self.agent_metadata
            else "unknown"
        )

        with _tracer.start_as_current_span("agent.execute") as span:
            span.set_attribute("agent.id", agent_id)
            span.set_attribute("agent.name", agent_name)
            span.set_attribute("agent.operation", "run_with_skill")
            span.set_attribute("input.length", len(user_prompt))
            span.set_attribute("skill.requested", skill_name or "auto")

            try:
                # Build runtime state and parse prompt references
                state = self._build_runtime_state(context, user_prompt)
                system_prompt_refs = parse_prompt_references(self.system_prompt)

                # Resolve skill to use
                selected_skill = resolve_skill(
                    skill_name,
                    self.skills,
                    system_prompt_refs,
                    state["warnings"],
                )

                # If no skill found, fall back to regular agent execution
                if selected_skill is None:
                    response = await self.run(user_prompt, context=context)
                    state["message"] = response

                    duration = time.time() - start_time
                    record_agent_execution(
                        agent_name=agent_name,
                        status="success",
                        model=self.llm_client.model,
                    )

                    span.set_attribute("output.length", len(response))
                    span.set_attribute("skill.used", False)
                    span.set_attribute("duration_ms", duration * 1000)
                    span.set_status(trace.StatusCode.OK)

                    return {
                        "response": response,
                        "tool_calls": [],
                        "state": state,
                    }

                # Execute with skill
                self._update_skill_state(state, selected_skill)
                span.set_attribute("skill.name", selected_skill.get("name", "unknown"))
                span.set_attribute("skill.id", selected_skill.get("id", "unknown"))

                # Prepare tool execution
                tool_calls: list[dict[str, Any]] = []
                allowed_tool_names = self._tool_executor.resolve_skill_allowed_tools(
                    selected_skill
                )
                referenced_tool_names, referenced_tool_warnings = (
                    self._tool_executor.resolve_prompt_referenced_tools(
                        selected_skill,
                        [
                            *system_prompt_refs.tool_references,
                            *parse_prompt_references(
                                str(selected_skill.get("instructions", "")),
                            ).tool_references,
                        ],
                    )
                )
                state["warnings"].extend(referenced_tool_warnings)

                # Render system prompt
                rendered_system_prompt = self._render_prompt_sections(
                    system_prompt_refs.cleaned_text,
                    state,
                    state["warnings"],
                )
                memory_context = self._render_memory_context(state)
                if memory_context:
                    rendered_system_prompt = (
                        f"{rendered_system_prompt}\n\n{memory_context}"
                    ).strip()

                # Build skill tools
                skill_tools = self._tool_executor.build_skill_tools(
                    allowed_tool_names,
                    state,
                    tool_calls,
                )

                # Create and execute skill agent
                from pydantic_ai import Agent as PydanticAgent

                instructions_parts = [selected_skill.get("instructions", "")]
                if referenced_tool_names:
                    prompt_tool_names = ", ".join(referenced_tool_names)
                    instructions_parts.append(
                        f"Prompt-referenced tools: {prompt_tool_names}."
                    )
                if allowed_tool_names:
                    allowed_names = ", ".join(allowed_tool_names)
                    instructions_parts.append(
                        (
                            "Use tools when external data or actions are required. "
                            f"Allowed tools: {allowed_names}."
                        )
                    )

                instructions = "\n\n".join(filter(None, instructions_parts))

                await self.llm_client._ensure_credentials()
                skill_agent = PydanticAgent(
                    self.llm_client._get_pydantic_model(),
                    instructions=instructions,
                    tools=skill_tools,
                )

                # Execute skill
                response = await skill_agent.run(
                    user_prompt,
                    deps=LLMDeps(
                        tenant_id=bootstrap_settings.TENANT_ID or "default",
                        agent_id=agent_id,
                        conversation_id=context.get("conversation_id")
                        if context
                        else None,
                        tool_registry=self.tool_registry,
                        metadata=self.agent_metadata,
                    ),
                )

                # Record metrics and return result
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="success",
                    model=self.llm_client.model,
                )

                response_text = _extract_run_text(response)
                span.set_attribute("output.length", len(response_text))
                span.set_attribute("skill.used", True)
                span.set_attribute("duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)

                return {
                    "response": response_text,
                    "tool_calls": tool_calls,
                    "state": state,
                }

            except Exception as e:
                # Record metrics for error
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="error",
                    model=self.llm_client.model,
                )

                span.record_exception(e)
                span.set_attribute("duration_ms", (time.time() - start_time) * 1000)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    def _render_prompt_sections(
        self,
        value: str,
        state: dict[str, Any],
        warnings: list[str],
    ) -> str:
        return self._renderer.render_prompt_text(value, state, warnings)

    def _build_runtime_state(
        self,
        context: dict[str, Any] | None,
        user_prompt: str,
    ) -> dict[str, Any]:
        normalized_context = self._normalize_mapping(context)
        input_state = self._normalize_mapping(normalized_context.get("input"))
        context_state = self._normalize_mapping(normalized_context.get("context"))
        memory_state = self._normalize_mapping(normalized_context.get("memory"))

        for key, value in normalized_context.items():
            if key in {"input", "context", "memory", "agent", "skill"}:
                continue
            if key in {"customer_message", "customer_name", "message", "user_prompt"}:
                input_state.setdefault(key, value)
            else:
                context_state.setdefault(key, value)

        input_state.setdefault("message", user_prompt)
        input_state.setdefault("user_prompt", user_prompt)

        tool_names = self._configured_tool_names()
        skill_names = self._configured_skill_names()
        agent_state = {
            "id": str(self.agent_metadata.get("id", "")).strip(),
            "name": str(self.agent_metadata.get("name", "")).strip(),
            "description": str(self.agent_metadata.get("description", "")).strip(),
            "available_skills": skill_names,
            "available_tools": tool_names,
        }
        skill_state = {
            "id": "",
            "name": "",
            "description": "",
        }

        state = dict(normalized_context)
        state["input"] = input_state
        state["context"] = context_state
        state["memory"] = memory_state
        state["agent"] = agent_state
        state["skill"] = skill_state
        state["user_prompt"] = user_prompt
        state["message"] = input_state.get("message", user_prompt)
        state["warnings"] = []
        return state

    @staticmethod
    def _update_skill_state(state: dict[str, Any], skill: dict[str, Any]) -> None:
        state["skill"] = {
            "id": str(skill.get("id", "")).strip(),
            "name": str(skill.get("name", "")).strip(),
            "description": str(skill.get("description", "")).strip(),
        }

    def _configured_skill_names(self) -> list[str]:
        skill_names: list[str] = []
        for skill in self.skills:
            if not isinstance(skill, dict) or skill.get("enabled", True) is False:
                continue
            for key in ("name", "id"):
                value = str(skill.get(key, "")).strip()
                if value and value not in skill_names:
                    skill_names.append(value)
        return skill_names

    def _configured_tool_names(self) -> list[str]:
        tool_names: list[str] = []
        for tool in self._tool_executor.tools:
            if not isinstance(tool, dict) or tool.get("enabled", True) is False:
                continue
            value = str(tool.get("name", "")).strip()
            if value and value not in tool_names:
                tool_names.append(value)
        return tool_names

    def _render_memory_context(self, state: dict[str, Any]) -> str:
        """Render a compact memory summary for the system prompt."""
        memory_state = self._normalize_mapping(state.get("memory"))
        if not memory_state:
            return ""

        tenant_state = self._normalize_mapping(memory_state.get("tenant"))
        summary = str(tenant_state.get("summary", "")).strip()
        items = tenant_state.get("items")

        sections: list[str] = []
        if summary:
            sections.append(f"Tenant memory summary:\n{summary}")

        if isinstance(items, list):
            memory_lines: list[str] = []
            for item in items[:10]:
                if isinstance(item, dict):
                    title = str(
                        item.get("title")
                        or item.get("memory_key")
                        or item.get("id")
                        or "Memory"
                    ).strip()
                    content = str(
                        item.get("content") or item.get("content_excerpt") or ""
                    ).strip()
                    if content:
                        memory_lines.append(f"- {title}: {content}")
                    else:
                        memory_lines.append(f"- {title}")
                else:
                    text = str(item).strip()
                    if text:
                        memory_lines.append(f"- {text}")

            if memory_lines:
                sections.append("Tenant memories:\n" + "\n".join(memory_lines))

        return "\n\n".join(sections).strip()

    @staticmethod
    def _normalize_mapping(value: Any) -> dict[str, Any]:
        if isinstance(value, BaseModel):
            return value.model_dump()
        if isinstance(value, dict):
            return dict(value)
        return {}
