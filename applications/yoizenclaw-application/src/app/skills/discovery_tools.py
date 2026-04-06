"""Discovery tools for LLM-driven skill selection.

Provides SelectSkill and ListSkills tools that allow the LLM to
discover and activate skills based on user intent.
"""

from __future__ import annotations

import logging
from typing import Any

from src.app.tools.tool_def import ToolDef
from .router import SkillRouter, SkillContext

logger = logging.getLogger(__name__)


class SkillDiscoveryTools:
    """Creates tools for LLM-driven skill discovery and selection."""

    def __init__(self, skill_router: SkillRouter) -> None:
        """Initialize discovery tools with a skill router."""
        self.skill_router = skill_router

    def create_select_skill_tool(self) -> ToolDef:
        """Create the SelectSkill tool for LLM to activate skills."""

        def select_skill_func(
            params: dict[str, Any], config: dict[str, Any]
        ) -> dict[str, Any]:
            """Select a skill for activation based on user intent."""
            skill_name = params.get("skill_name", "").strip()
            reasoning = params.get("reasoning", "").strip()
            user_intent = params.get("user_intent", "").strip()

            if not skill_name:
                return {
                    "success": False,
                    "error": "skill_name is required",
                }

            # Validate the skill exists
            skill, warnings = self.skill_router.validate_skill_selection(skill_name)

            if not skill:
                return {
                    "success": False,
                    "error": f"Skill '{skill_name}' not found",
                    "warnings": warnings,
                }

            # Create context for validation
            context = SkillContext(
                user_message=user_intent or f"Activate skill: {skill_name}",
                explicit_skill_name=skill_name,
                available_skills=self.skill_router.enabled_skills,
            )

            # Verify the skill would be selected
            resolved_skill = self.skill_router.resolve(context)

            if resolved_skill and resolved_skill.name == skill_name:
                logger.info(
                    f"LLM selected skill: {skill_name} (reasoning: {reasoning})"
                )

                return {
                    "success": True,
                    "skill_name": skill_name,
                    "skill_id": skill.id,
                    "description": skill.description,
                    "when_to_use": skill.when_to_use,
                    "triggers": skill.triggers,
                    "arguments": skill.arguments,
                    "allowed_tools": skill.allowed_tools,
                    "context_mode": skill.context_mode,
                    "model_override": skill.model_override,
                    "llm_reasoning": reasoning,
                    "user_intent": user_intent,
                }
            else:
                return {
                    "success": False,
                    "error": f"Skill '{skill_name}' validation failed",
                    "selected_instead": resolved_skill.name if resolved_skill else None,
                    "warnings": warnings + context.warnings,
                }

        return ToolDef(
            name="SelectSkill",
            description="Select and activate a skill based on user intent and skill capabilities",
            input_schema={
                "type": "object",
                "properties": {
                    "skill_name": {
                        "type": "string",
                        "description": "The name of the skill to select",
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Why this skill is appropriate for the user's request",
                    },
                    "user_intent": {
                        "type": "string",
                        "description": "What the user is trying to accomplish",
                    },
                },
                "required": ["skill_name"],
            },
            func=select_skill_func,
            read_only=True,
            max_output_chars=8192,
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
            self.create_select_skill_tool(),
            self.create_list_skills_tool(),
        ]


def create_discovery_tools(skill_router: SkillRouter) -> list[ToolDef]:
    """Convenience function to create all discovery tools."""
    discovery = SkillDiscoveryTools(skill_router)
    return discovery.get_all_discovery_tools()
