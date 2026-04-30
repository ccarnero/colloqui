"""Discovery tools for LLM-driven skill selection.

Provides ActivateSkill and ListSkills tools that allow the LLM to
discover and activate skills based on user intent.  ActivateSkill
returns the full skill instructions (lazy loading) so the LLM can
follow them to respond.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from src.app.tools.tool_def import ToolDef
from .router import SkillRouter, SkillContext

logger = logging.getLogger(__name__)


class SkillDiscoveryTools:
    """Creates tools for LLM-driven skill discovery and selection."""

    def __init__(
        self,
        skill_router: SkillRouter,
        on_activate: Callable[[Any], None] | None = None,
    ) -> None:
        """Initialize discovery tools with a skill router.

        Args:
            skill_router: Router with available skills.
            on_activate: Optional callback invoked when the LLM activates
                a skill via ``ActivateSkill``.  Receives the
                ``SkillDefinition`` instance.
        """
        self.skill_router = skill_router
        self._on_activate_callback = on_activate

    def create_activate_skill_tool(self) -> ToolDef:
        """Create the ActivateSkill tool for LLM-driven skill loading.

        When called, returns the full skill instructions so the LLM can
        follow them to respond to the user. This enables lazy-loading:
        the system prompt only contains a lightweight catalog, and the
        LLM fetches full instructions on demand.
        """
        on_activate = self._on_activate_callback

        def activate_skill_func(
            params: dict[str, Any], config: dict[str, Any]
        ) -> dict[str, Any]:
            """Activate a skill and receive its full instructions."""
            skill_name = params.get("skill_name", "").strip()
            reasoning = params.get("reasoning", "").strip()

            if not skill_name:
                return {
                    "success": False,
                    "error": "skill_name is required",
                }

            skill, warnings = self.skill_router.validate_skill_selection(skill_name)

            if not skill:
                return {
                    "success": False,
                    "error": f"Skill '{skill_name}' not found",
                    "available_skills": [
                        s.name for s in self.skill_router.enabled_skills
                    ],
                    "warnings": warnings,
                }

            logger.info(
                f"LLM activated skill: {skill_name} (reasoning: {reasoning})"
            )

            if on_activate:
                on_activate(skill)

            return {
                "success": True,
                "skill_name": skill_name,
                "skill_id": skill.id,
                "instructions": skill.instructions,
                "allowed_tools": skill.allowed_tools,
                "arguments": skill.arguments,
                "guidance": (
                    "Follow the instructions above to handle the user's request. "
                    "Use only the allowed_tools listed if any are specified."
                ),
            }

        return ToolDef(
            name="ActivateSkill",
            description=(
                "Activate a skill to receive its full instructions. "
                "Call this when you detect the user's intent matches one of the available skills. "
                "The returned instructions tell you exactly how to handle the request."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "skill_name": {
                        "type": "string",
                        "description": "The name of the skill to activate (from the available skills catalog)",
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Brief explanation of why this skill matches the user's intent",
                    },
                },
                "required": ["skill_name"],
            },
            func=activate_skill_func,
            read_only=True,
            max_output_chars=16384,
        )

    def create_list_skills_tool(self) -> ToolDef:
        """Create the ListSkills tool for LLM to discover available skills."""

        def list_skills_func(
            params: dict[str, Any], config: dict[str, Any]
        ) -> dict[str, Any]:
            """List all available skills with their capabilities."""
            filter_by_trigger = params.get("filter_by_trigger", "").strip()
            include_disabled = params.get("include_disabled", False)

            skills_to_list = self.skill_router.enabled_skills
            if include_disabled:
                skills_to_list = self.skill_router.skills

            # Filter by trigger if specified
            if filter_by_trigger:
                skills_to_list = [
                    skill
                    for skill in skills_to_list
                    if filter_by_trigger in skill.triggers
                ]

            # Format skill information
            skill_list = []
            for skill in skills_to_list:
                skill_info = {
                    "name": skill.name,
                    "id": skill.id,
                    "description": skill.description,
                    "enabled": skill.enabled,
                    "priority": skill.priority,
                }

                # Add optional fields if they exist
                if skill.when_to_use:
                    skill_info["when_to_use"] = skill.when_to_use

                if skill.triggers:
                    skill_info["triggers"] = skill.triggers

                if skill.arguments:
                    skill_info["arguments"] = skill.arguments

                if skill.allowed_tools:
                    skill_info["allowed_tools"] = skill.allowed_tools

                if skill.context_mode != "inline":
                    skill_info["context_mode"] = skill.context_mode

                if skill.model_override:
                    skill_info["model_override"] = skill.model_override

                skill_list.append(skill_info)

            # Sort by priority (highest first)
            skill_list.sort(key=lambda s: s["priority"], reverse=True)

            return {
                "success": True,
                "skills": skill_list,
                "total_count": len(skill_list),
                "filter_by_trigger": filter_by_trigger or None,
                "include_disabled": include_disabled,
                "routing_summary": self.skill_router.get_skill_summaries_for_llm(),
            }

        return ToolDef(
            name="ListSkills",
            description="List all available skills with their capabilities and usage guidance",
            input_schema={
                "type": "object",
                "properties": {
                    "filter_by_trigger": {
                        "type": "string",
                        "description": "Optional: filter skills by trigger command (e.g., '/help')",
                    },
                    "include_disabled": {
                        "type": "boolean",
                        "default": False,
                        "description": "Include disabled skills in the results",
                    },
                },
            },
            func=list_skills_func,
            read_only=True,
            max_output_chars=16384,
        )

    def get_all_discovery_tools(self) -> list[ToolDef]:
        """Get all discovery tools for registration."""
        return [
            self.create_activate_skill_tool(),
            self.create_list_skills_tool(),
        ]


def create_discovery_tools(
    skill_router: SkillRouter,
    on_activate: Callable[[Any], None] | None = None,
) -> list[ToolDef]:
    """Convenience function to create all discovery tools."""
    discovery = SkillDiscoveryTools(skill_router, on_activate=on_activate)
    return discovery.get_all_discovery_tools()
