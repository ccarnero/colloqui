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

from src.application.agents.prompt_references import parse_prompt_references
from src.shared.config.prompts import PromptLoader
from src.application.llm.llm_service import LLMClient
from src.application.agents.condition_evaluator import ConditionEvaluator
from src.application.agents.template_renderer import TemplateRenderer
from src.application.agents.tool_executor import ToolExecutor
from src.tools.registry import ToolRegistry
from src.shared.telemetry import get_tracer, record_agent_execution

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


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
        self.skills = self._normalize_config_items(skills)
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
        agent_name = self.agent_metadata.get("name", "unknown") if self.agent_metadata else "unknown"
        agent_id = self.agent_metadata.get("id", "unknown") if self.agent_metadata else "unknown"

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

                response = await self.llm_client.generate(
                    user_prompt,
                    system_prompt=rendered_system_prompt,
                )
                
                # Record metrics
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="success",
                    model=self.llm_client.model,
                )
                
                span.set_attribute("output.length", len(response.content))
                span.set_attribute("duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
                
                return response.content
                
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
        agent_name = self.agent_metadata.get("name", "unknown") if self.agent_metadata else "unknown"
        agent_id = self.agent_metadata.get("id", "unknown") if self.agent_metadata else "unknown"

        with _tracer.start_as_current_span("agent.execute") as span:
            span.set_attribute("agent.id", agent_id)
            span.set_attribute("agent.name", agent_name)
            span.set_attribute("agent.operation", "run_with_skill")
            span.set_attribute("input.length", len(user_prompt))
            span.set_attribute("skill.requested", skill_name or "auto")

            try:
                state = self._build_runtime_state(context, user_prompt)
                system_prompt_refs = parse_prompt_references(self.system_prompt)
                selected_skill: dict[str, Any] | None = None
                if skill_name:
                    selected_skill = self._select_skill(skill_name)
                if selected_skill is None:
                    selected_skill = self._select_skill_from_references(
                        list(system_prompt_refs.skill_references),
                        state["warnings"],
                    )
                if selected_skill is None:
                    selected_skill = self._select_skill(None)
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

                self._update_skill_state(state, selected_skill)
                span.set_attribute("skill.name", selected_skill.get("name", "unknown"))
                span.set_attribute("skill.id", selected_skill.get("id", "unknown"))

                tool_calls: list[dict[str, Any]] = []
                allowed_tool_names = self._tool_executor.resolve_skill_allowed_tools(
                    selected_skill,
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
                rendered_system_prompt = self._render_prompt_sections(
                    system_prompt_refs.cleaned_text,
                    state,
                    state["warnings"],
                )
                skill_prompt = self._build_skill_prompt(
                    selected_skill,
                    state,
                    referenced_tool_names,
                    state["warnings"],
                )

                span.set_attribute("tools.allowed_count", len(allowed_tool_names))
                span.set_attribute("tools.referenced_count", len(referenced_tool_names))

                if self.llm_client.supports_tool_execution() and allowed_tool_names:
                    skill_tools = self._tool_executor.build_skill_tools(
                        allowed_tool_names,
                        state,
                        tool_calls,
                    )
                    skill_agent = self.llm_client.build_text_agent(
                        system_prompt=(rendered_system_prompt, skill_prompt),
                        tools=skill_tools,
                    )
                    result = await skill_agent.run(user_prompt)
                    response = result.output if isinstance(result.output, str) else str(
                        result.output,
                    )
                else:
                    step_response = await self.llm_client.generate(
                        user_prompt,
                        system_prompt=f"{rendered_system_prompt}\n\n{skill_prompt}",
                    )
                    response = step_response.content.strip()

                state["active_skill"] = selected_skill.get("name")
                state["message"] = response
                
                # Record metrics
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="success",
                    model=self.llm_client.model,
                )
                
                span.set_attribute("output.length", len(response))
                span.set_attribute("tools.called_count", len(tool_calls))
                span.set_attribute("duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
                
                return {
                    "response": response,
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

    def _select_skill(self, skill_name: str | None) -> dict[str, Any] | None:
        enabled_skills = [
            skill
            for skill in self.skills
            if isinstance(skill, dict) and skill.get("enabled", True) is not False
        ]
        if not enabled_skills:
            return None

        if skill_name:
            for skill in enabled_skills:
                if str(skill.get("id", "")).strip() == skill_name:
                    return skill
                if str(skill.get("name", "")).strip() == skill_name:
                    return skill

        return enabled_skills[0]

    def _build_skill_prompt(
        self,
        skill: dict[str, Any],
        state: dict[str, Any],
        referenced_tool_names: list[str],
        warnings: list[str],
    ) -> str:
        reference_result = parse_prompt_references(
            str(skill.get("instructions", "")),
        )
        if reference_result.skill_references:
            warnings.append(
                "Skill instructions contain '@skill:' references. They are informational only once a skill is active.",
            )
        instructions = self._render_prompt_sections(
            reference_result.cleaned_text,
            state,
            warnings,
        ).strip()
        allowed_tools = self._tool_executor.resolve_skill_allowed_tools(skill)
        allowed_tools_text = ", ".join(allowed_tools) if allowed_tools else "none"
        sections = [
            f"Active skill: {skill.get('name', 'skill')}\n"
            f"Skill description: {skill.get('description', '')}\n"
            f"Skill instructions:\n{instructions}\n\n"
            "You may answer freely. If tools are available, use them only when "
            "they materially help. Allowed tools: "
            f"{allowed_tools_text}."
        ]
        if referenced_tool_names:
            sections.append(
                "Prompt-referenced tools: "
                + ", ".join(referenced_tool_names)
                + ". Prefer them when they materially help and remain allowed.",
            )
        return "\n\n".join(sections)

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

    def _select_skill_from_references(
        self,
        referenced_skill_names: list[str],
        warnings: list[str],
    ) -> dict[str, Any] | None:
        for skill_reference in referenced_skill_names:
            selected_skill = self._select_skill(skill_reference)
            if selected_skill is not None:
                return selected_skill
            warnings.append(
                f"Prompt referenced skill '@skill:{skill_reference}' but no enabled skill matched it.",
            )
        return None

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

    @staticmethod
    def _normalize_mapping(value: Any) -> dict[str, Any]:
        if isinstance(value, BaseModel):
            return value.model_dump()
        if isinstance(value, dict):
            return dict(value)
        return {}

    @staticmethod
    def _normalize_config_items(values: list[Any] | None) -> list[Any]:
        normalized: list[Any] = []
        for value in values or []:
            if isinstance(value, BaseModel):
                normalized.append(value.model_dump())
            else:
                normalized.append(value)
        return normalized
