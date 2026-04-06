"""Skill execution engine with inline and fork modes.

Handles skill execution with argument substitution and context isolation
for fork mode execution.
"""

from __future__ import annotations

import logging
from typing import Any

from .skill_def import SkillDefinition
from .arguments import substitute_arguments
from ..agents.agent import Agent

logger = logging.getLogger(__name__)


class SkillExecutor:
    """Executes skills with argument substitution and context management."""

    def __init__(
        self,
        default_llm_config: dict[str, Any] | None = None,
        default_tools: list[Any] | None = None,
        tool_registry: Any | None = None,
    ) -> None:
        """Initialize the skill executor.

        Args:
            default_llm_config: Default LLM configuration for fork mode
            default_tools: Default tools available to forked agents
            tool_registry: Tool registry for tool resolution
        """
        self.default_llm_config = default_llm_config or {}
        self.default_tools = default_tools or []
        self.tool_registry = tool_registry

    async def execute(
        self,
        skill: SkillDefinition,
        user_message: str,
        context: dict[str, Any] | None = None,
        skill_args: str = "",
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute a skill with the given context and arguments.

        Args:
            skill: The skill definition to execute
            user_message: The original user message
            context: Additional context for execution
            skill_args: Raw argument string for substitution
            **kwargs: Additional named arguments

        Returns:
            Execution result with metadata
        """
        if context is None:
            context = {}

        # Substitute arguments in skill instructions
        substituted_instructions = self._substitute_instructions(
            skill, skill_args, **kwargs
        )

        # Choose execution mode
        if skill.context_mode == "fork":
            return await self._execute_fork(
                skill, user_message, substituted_instructions, context, skill_args
            )
        else:
            return await self._execute_inline(
                skill, user_message, substituted_instructions, context, skill_args
            )

    def _substitute_instructions(
        self, skill: SkillDefinition, skill_args: str = "", **kwargs: Any
    ) -> str:
        """Substitute arguments in skill instructions."""
        # Add skill arguments to kwargs for substitution
        for i, arg_name in enumerate(skill.arguments):
            if f"ARG_{i + 1}" not in kwargs:
                # Try to get from skill_args by position
                arg_parts = skill_args.strip().split()
                if i < len(arg_parts):
                    kwargs[f"ARG_{i + 1}"] = arg_parts[i]

        # Add named arguments from skill_args
        if skill_args and "=" in skill_args:
            # Parse key=value arguments
            for part in skill_args.strip().split():
                if "=" in part:
                    key, value = part.split("=", 1)
                    kwargs[key.strip()] = value.strip()

        return substitute_arguments(
            skill.instructions, skill.arguments, skill_args, **kwargs
        )

    async def _execute_inline(
        self,
        skill: SkillDefinition,
        user_message: str,
        instructions: str,
        context: dict[str, Any],
        skill_args: str,
    ) -> dict[str, Any]:
        """Execute skill in inline mode (same context)."""
        logger.info(f"Executing skill '{skill.name}' in inline mode")

        # For inline mode, we return the processed instructions and context
        # The actual LLM execution will be handled by the calling agent
        return {
            "success": True,
            "skill_name": skill.name,
            "skill_id": skill.id,
            "execution_mode": "inline",
            "processed_instructions": instructions,
            "user_message": user_message,
            "skill_args": skill_args,
            "context": context,
            "allowed_tools": skill.allowed_tools,
            "model_override": skill.model_override,
            "metadata": {
                "substitution_applied": bool(skill.instructions != instructions),
                "has_arguments": len(skill.arguments) > 0,
                "raw_args": skill_args,
            },
        }

    async def _execute_fork(
        self,
        skill: SkillDefinition,
        user_message: str,
        instructions: str,
        context: dict[str, Any],
        skill_args: str,
    ) -> dict[str, Any]:
        """Execute skill in fork mode (isolated agent)."""
        logger.info(f"Executing skill '{skill.name}' in fork mode")

        try:
            forked_agent = self._create_forked_agent(skill, instructions)

            result = await forked_agent.run(user_message, context=context)

            return {
                "success": True,
                "skill_name": skill.name,
                "skill_id": skill.id,
                "execution_mode": "fork",
                "isolated_result": result,
                "user_message": user_message,
                "skill_args": skill_args,
                "context": context,
                "model_used": skill.model_override
                or self.default_llm_config.get("model"),
                "metadata": {
                    "substitution_applied": bool(skill.instructions != instructions),
                    "has_arguments": len(skill.arguments) > 0,
                    "raw_args": skill_args,
                    "agent_created": True,
                },
            }

        except Exception as e:
            logger.error(f"Fork execution failed for skill '{skill.name}': {e}")
            return {
                "success": False,
                "skill_name": skill.name,
                "skill_id": skill.id,
                "execution_mode": "fork",
                "error": str(e),
                "user_message": user_message,
                "skill_args": skill_args,
                "metadata": {
                    "substitution_applied": bool(skill.instructions != instructions),
                    "has_arguments": len(skill.arguments) > 0,
                    "raw_args": skill_args,
                    "agent_created": False,
                },
            }

    def _create_forked_agent(self, skill: SkillDefinition, instructions: str) -> Agent:
        """Create an isolated agent for fork execution."""
        # Determine LLM config
        llm_config = dict(self.default_llm_config)
        if skill.model_override:
            llm_config["model"] = skill.model_override

        # Filter tools based on skill's allowed_tools
        available_tools = self._filter_tools(skill.allowed_tools)

        # Create the forked agent
        forked_agent = Agent(
            system_prompt=instructions,
            llm_config=llm_config,
            tools=available_tools,
            # Note: Skills don't have nested skills in fork mode
            skills=None,
            agent_metadata={"forked_from": skill.name, "execution_mode": "fork"},
        )

        return forked_agent

    def _filter_tools(self, allowed_tools: list[str]) -> list[Any]:
        """Filter available tools based on skill's allowed_tools list."""
        if not allowed_tools or not self.tool_registry:
            return self.default_tools

        filtered_tools = []

        # If we have a tool registry, get tools by name
        if self.tool_registry:
            for tool_name in allowed_tools:
                tool_def = self.tool_registry.get_tool(tool_name)
                if tool_def:
                    filtered_tools.append(tool_def)

        return filtered_tools or self.default_tools

    def validate_skill_execution(
        self, skill: SkillDefinition, skill_args: str = ""
    ) -> tuple[bool, list[str]]:
        """Validate that a skill can be executed with the given arguments."""
        warnings = []

        # Validate argument substitution
        from .arguments import validate_skill_arguments

        is_valid, arg_warnings = validate_skill_arguments(
            skill.instructions, skill.arguments, skill_args
        )
        warnings.extend(arg_warnings)

        # Check tool availability for fork mode
        if skill.context_mode == "fork" and skill.allowed_tools:
            if self.tool_registry:
                missing_tools = []
                for tool_name in skill.allowed_tools:
                    if not self.tool_registry.get_tool(tool_name):
                        missing_tools.append(tool_name)

                if missing_tools:
                    warnings.append(
                        f"Tools not available for fork mode: {', '.join(missing_tools)}"
                    )

        return is_valid and len(warnings) == 0, warnings
