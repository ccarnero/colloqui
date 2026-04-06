"""Skill routing logic for intelligent skill selection.

Implements the resolution logic for selecting the appropriate skill
based on triggers, explicit names, and LLM-driven selection.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from .skill_def import SkillDefinition

logger = logging.getLogger(__name__)


@dataclass
class SkillContext:
    """Context provided to the skill router for decision making."""
    user_message: str
    explicit_skill_name: str | None = None
    available_skills: list[SkillDefinition] = None
    warnings: list[str] = None
    
    def __post_init__(self) -> None:
        if self.available_skills is None:
            self.available_skills = []
        if self.warnings is None:
            self.warnings = []


class SkillRouter:
    """Selects the appropriate skill for a given request.
    
    Resolution order:
    1. Trigger matching (explicit commands like /sales, /help)
    2. Explicit skill name parameter
    3. LLM-driven selection via when_to_use (future: SelectSkill tool)
    4. Priority-based fallback
    """

    def __init__(self, skills: list[SkillDefinition]) -> None:
        """Initialize router with available skills."""
        self.skills = skills
        self.enabled_skills = [skill for skill in skills if skill.enabled]
        
        if not self.enabled_skills:
            logger.warning("No enabled skills available for routing")
        
        # Create lookup maps for performance
        self._skill_by_name = {skill.name: skill for skill in self.enabled_skills}
        self._skills_by_priority = sorted(self.enabled_skills, key=lambda s: s.priority, reverse=True)

    def resolve(self, context: SkillContext) -> SkillDefinition | None:
        """Resolve the best skill for the given context."""
        if not self.enabled_skills:
            context.warnings.append("No enabled skills available")
            return None

        # 1. Check for trigger matches
        trigger_skill = self._resolve_by_trigger(context)
        if trigger_skill:
            logger.debug(f"Selected skill by trigger: {trigger_skill.name}")
            return trigger_skill

        # 2. Check for explicit skill name
        explicit_skill = self._resolve_by_name(context)
        if explicit_skill:
            logger.debug(f"Selected skill by name: {explicit_skill.name}")
            return explicit_skill

        # 3. LLM-driven selection (placeholder for future SelectSkill tool)
        # For now, we'll skip this and go to priority fallback
        # llm_skill = self._resolve_by_llm(context)
        # if llm_skill:
        #     return llm_skill

        # 4. Priority-based fallback
        fallback_skill = self._resolve_by_priority()
        if fallback_skill:
            logger.debug(f"Selected skill by priority fallback: {fallback_skill.name}")
            context.warnings.append(
                f"Using priority fallback to skill '{fallback_skill.name}' "
                f"(no explicit trigger or name matched)"
            )
            return fallback_skill

        context.warnings.append("No skill could be resolved")
        return None

    def _resolve_by_trigger(self, context: SkillContext) -> SkillDefinition | None:
        """Resolve skill by checking trigger matches."""
        message = context.user_message.strip()
        
        # Find all skills with matching triggers
        matching_skills = []
        for skill in self.enabled_skills:
            if skill.has_trigger(message):
                matching_skills.append(skill)
        
        if not matching_skills:
            return None
        
        if len(matching_skills) == 1:
            return matching_skills[0]
        
        # Multiple matches - pick the one with highest priority
        best_skill = max(matching_skills, key=lambda s: s.priority)
        
        # Warn about ambiguity
        trigger_names = [skill.get_trigger_used(message) for skill in matching_skills]
        context.warnings.append(
            f"Multiple triggers matched ({', '.join(trigger_names)}), "
            f"selected '{best_skill.name}' by priority"
        )
        
        return best_skill

    def _resolve_by_name(self, context: SkillContext) -> SkillDefinition | None:
        """Resolve skill by explicit name."""
        if not context.explicit_skill_name:
            return None
        
        skill_name = context.explicit_skill_name.strip()
        skill = self._skill_by_name.get(skill_name)
        
        if not skill:
            context.warnings.append(
                f"Explicit skill '{skill_name}' not found, will use fallback"
            )
        
        return skill

    def _resolve_by_priority(self) -> SkillDefinition | None:
        """Resolve skill by priority (highest priority wins)."""
        if not self._skills_by_priority:
            return None
        
        return self._skills_by_priority[0]

    def get_skill_summaries_for_llm(self) -> str:
        """Get formatted skill summaries for LLM selection."""
        if not self.enabled_skills:
            return "No skills available."
        
        summaries = []
        for skill in self.enabled_skills:
            summary = f"- **{skill.name}**: {skill.get_summary_for_llm()}"
            summaries.append(summary)
        
        return "\n".join(summaries)

    def list_available_skills(self) -> list[dict[str, Any]]:
        """Get a list of available skills with their metadata."""
        return [
            {
                "id": skill.id,
                "name": skill.name,
                "description": skill.description,
                "when_to_use": skill.when_to_use,
                "triggers": skill.triggers,
                "arguments": skill.arguments,
                "priority": skill.priority,
            }
            for skill in self.enabled_skills
        ]

    def validate_skill_selection(self, skill_name: str) -> tuple[SkillDefinition | None, list[str]]:
        """Validate that a skill name is valid and return the skill."""
        warnings = []
        skill = self._skill_by_name.get(skill_name.strip())
        
        if not skill:
            warnings.append(f"Skill '{skill_name}' not found")
            available_names = list(self._skill_by_name.keys())
            if available_names:
                warnings.append(f"Available skills: {', '.join(available_names)}")
            else:
                warnings.append("No skills are available")
        
        return skill, warnings
