"""Enhanced Agent with new skill routing system.

Integrates the new SkillDefinition, SkillRouter, and SkillExecutor
with the existing Agent infrastructure.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from opentelemetry import trace

from src.app.agents.agent import Agent
from src.app.skills.skill_def import SkillDefinition
from src.app.skills.router import SkillRouter, SkillContext
from src.app.skills.executor import SkillExecutor
from src.app.skills.discovery_tools import create_discovery_tools
from src.utils.telemetry import get_tracer, record_agent_execution

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


class EnhancedAgent(Agent):
    """Enhanced Agent with new skill routing and execution capabilities.

    Extends the existing Agent class to use:
    - SkillDefinition instead of legacy skill dicts
    - SkillRouter for intelligent selection
    - SkillExecutor for argument substitution and fork mode
    - Discovery tools for LLM-driven skill selection
    """

    def __init__(
        self,
        system_prompt: str,
        llm_config: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        skills: list[dict[str, Any]] | None = None,
        prompt_loader=None,
        tool_registry=None,
        agent_metadata: dict[str, Any] | None = None,
        **kwargs,
    ) -> None:
        """Initialize the enhanced agent."""
        # Initialize the base agent first
        super().__init__(
            system_prompt=system_prompt,
            llm_config=llm_config,
            tools=tools,
            skills=skills,  # Will be converted to SkillDefinition
            prompt_loader=prompt_loader,
            tool_registry=tool_registry,
            agent_metadata=agent_metadata,
            **kwargs,
        )

        # Convert legacy skills to SkillDefinition
        self.skill_definitions = self._convert_legacy_skills(skills or [])

        # Initialize skill routing components
        self.skill_router = SkillRouter(self.skill_definitions)
        self.skill_executor = SkillExecutor(
            default_llm_config=llm_config or {},
            default_tools=tools or [],
            tool_registry=tool_registry,
        )

        # Register discovery tools with the tool registry
        self._register_discovery_tools()

    def _convert_legacy_skills(
        self, legacy_skills: list[dict[str, Any]]
    ) -> list[SkillDefinition]:
        """Convert legacy skill dictionaries to SkillDefinition objects."""
        skill_definitions = []

        for skill_data in legacy_skills:
            # Skip disabled skills
            if not skill_data.get("enabled", True):
                continue

            # Convert to SkillDefinition
            skill_def = SkillDefinition(
                id=skill_data.get("id", skill_data.get("name", "unknown")),
                name=skill_data.get("name", "unknown"),
                description=skill_data.get("description", ""),
                enabled=skill_data.get("enabled", True),
                instructions=skill_data.get("instructions", ""),
                # New fields with defaults
                when_to_use=skill_data.get("when_to_use", ""),
                triggers=skill_data.get("triggers", []),
                arguments=skill_data.get("arguments", []),
                allowed_tools=skill_data.get(
                    "allowed_tools", skill_data.get("allowedTools", [])
                ),
                context_mode=skill_data.get("context_mode", "inline"),
                model_override=skill_data.get("model_override"),
                priority=skill_data.get("priority", 0),
                config=skill_data.get("config", {}),
            )
            skill_definitions.append(skill_def)

        return skill_definitions

    def _register_discovery_tools(self) -> None:
        """Register skill discovery tools with the tool registry."""
        if not self.tool_registry:
            return

        discovery_tools = create_discovery_tools(self.skill_router)

        for tool_def in discovery_tools:
            self.tool_registry.register_tool_def(tool_def)

        logger.info(f"Registered {len(discovery_tools)} discovery tools")

    async def run_with_enhanced_skill(
        self,
        user_prompt: str,
        context: dict[str, Any] | None = None,
        skill_name: str | None = None,
        skill_args: str = "",
        **kwargs,
    ) -> dict[str, Any]:
        """Run the agent with enhanced skill routing and execution."""
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

        with _tracer.start_as_current_span("enhanced_agent.execute") as span:
            span.set_attribute("agent.id", agent_id)
            span.set_attribute("agent.name", agent_name)
            span.set_attribute("agent.operation", "run_with_enhanced_skill")
            span.set_attribute("input.length", len(user_prompt))
            span.set_attribute("skill.requested", skill_name or "auto")

            try:
                # Build runtime state
                state = self._build_runtime_state(context, user_prompt)

                # Use new SkillRouter for resolution
                skill_context = SkillContext(
                    user_message=user_prompt,
                    explicit_skill_name=skill_name,
                    available_skills=self.skill_definitions,
                    warnings=state["warnings"],
                )

                selected_skill = self.skill_router.resolve(skill_context)

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
                        "skill_used": None,
                    }

                # Execute with enhanced skill system
                span.set_attribute("skill.name", selected_skill.name)
                span.set_attribute("skill.id", selected_skill.id)
                span.set_attribute("skill.execution_mode", selected_skill.context_mode)

                # Validate skill execution
                is_valid, validation_warnings = (
                    self.skill_executor.validate_skill_execution(
                        selected_skill, skill_args
                    )
                )
                state["warnings"].extend(validation_warnings)

                if not is_valid:
                    # Fall back to regular execution if validation fails
                    logger.warning(
                        f"Skill validation failed for '{selected_skill.name}', falling back"
                    )
                    response = await self.run(user_prompt, context=context)
                    state["message"] = response

                    return {
                        "response": response,
                        "tool_calls": [],
                        "state": state,
                        "skill_used": selected_skill.name,
                        "validation_failed": True,
                        "validation_warnings": validation_warnings,
                    }

                # Execute skill with new executor
                skill_result = await self.skill_executor.execute(
                    selected_skill, user_prompt, context, skill_args, **kwargs
                )

                # Handle different execution modes
                if selected_skill.context_mode == "inline":
                    # Inline mode: integrate with existing tool execution
                    return await self._execute_inline_skill(
                        selected_skill, skill_result, user_prompt, context, state, span
                    )
                else:
                    # Fork mode: return the isolated result
                    duration = time.time() - start_time
                    record_agent_execution(
                        agent_name=agent_name,
                        status="success",
                        model=skill_result.get("model_used", self.llm_client.model),
                    )

                    span.set_attribute("skill.mode", "fork")
                    span.set_attribute("duration_ms", duration * 1000)
                    span.set_status(trace.StatusCode.OK)

                    return {
                        "response": skill_result.get("isolated_result", {}),
                        "tool_calls": [],
                        "state": state,
                        "skill_used": selected_skill.name,
                        "execution_mode": "fork",
                        "skill_result": skill_result,
                    }

            except Exception as e:
                duration = time.time() - start_time
                record_agent_execution(
                    agent_name=agent_name,
                    status="error",
                    model=self.llm_client.model,
                )

                span.record_exception(e)
                span.set_attribute("duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    async def _execute_inline_skill(
        self,
        skill: SkillDefinition,
        skill_result: dict[str, Any],
        user_prompt: str,
        context: dict[str, Any],
        state: dict[str, Any],
        span: trace.Span,
    ) -> dict[str, Any]:
        """Execute inline mode by delegating to legacy skill executor."""
        span.set_attribute("skill.mode", "inline")

        legacy_result = await super().run_with_skill(
            user_prompt,
            context=context,
            skill_name=skill.name,
        )
        legacy_result["skill_used"] = skill.name
        legacy_result["execution_mode"] = "inline"
        legacy_result["skill_result"] = skill_result
        return legacy_result

    def get_available_skills_summary(self) -> dict[str, Any]:
        """Get a summary of available skills for debugging/monitoring."""
        return {
            "total_skills": len(self.skill_definitions),
            "enabled_skills": len(self.skill_router.enabled_skills),
            "skills": self.skill_router.list_available_skills(),
            "routing_summary": self.skill_router.get_skill_summaries_for_llm(),
        }
