"""Skill routing logic for intelligent skill selection.

Implements the resolution logic for selecting the appropriate skill
based on triggers, explicit names, and LLM-driven selection.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from .skill_def import SkillDefinition

logger = logging.getLogger(__name__)

_TOKEN_PATTERN = re.compile(r"[a-z0-9_-]{3,}")
_TOKEN_ALIASES = {
    "precio": "pricing",
    "precios": "pricing",
    "costo": "pricing",
    "costos": "pricing",
    "presupuesto": "pricing",
    "presupuestos": "pricing",
    "price": "pricing",
    "comprar": "buy",
    "compra": "buy",
    "venta": "sales",
    "ventas": "sales",
    "soporte": "support",
    "ayuda": "support",
    "problema": "issue",
    "problemas": "issue",
    "error": "issue",
    "errores": "issue",
    "demostracion": "demo",
    "reunion": "meeting",
    "agendar": "schedule",
    "agenda": "schedule",
    "objecion": "objection",
    "objeciones": "objection",
    "competencia": "competitor",
}


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def _tokenize(value: str) -> set[str]:
    lowered = _strip_accents(value.lower())
    tokens = {
        _TOKEN_ALIASES.get(token, token) for token in _TOKEN_PATTERN.findall(lowered)
    }
    return {token for token in tokens if token}


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
    3. Semantic selection via skill metadata
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
        self._skills_by_priority = sorted(
            self.enabled_skills, key=lambda s: s.priority, reverse=True
        )

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
        semantic_skill = self._resolve_by_semantics(context)
        if semantic_skill:
            logger.debug(f"Selected skill by semantic match: {semantic_skill.name}")
            return semantic_skill

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

    def _resolve_by_semantics(self, context: SkillContext) -> SkillDefinition | None:
        """Resolve skill by keyword overlap against skill metadata."""
        message_tokens = _tokenize(context.user_message)
        if not message_tokens:
            return None

        best_match: SkillDefinition | None = None
        best_score = 0

        for skill in self.enabled_skills:
            score = self._score_skill(message_tokens, skill)
            if score <= 0:
                continue

            if score > best_score or (
                score == best_score
                and best_match is not None
                and skill.priority > best_match.priority
            ):
                best_match = skill
                best_score = score

        if best_match is None:
            return None

        context.warnings.append(
            (
                "Selected skill "
                f"'{best_match.name}' by semantic match (score={best_score})."
            )
        )
        return best_match

    @staticmethod
    def _score_skill(message_tokens: set[str], skill: SkillDefinition) -> int:
        """Score a skill by token overlap with metadata fields."""
        description_tokens = _tokenize(skill.description)
        when_to_use_tokens = _tokenize(skill.when_to_use)
        name_tokens = _tokenize(skill.name)
        trigger_tokens = set()
        for trigger in skill.triggers:
            trigger_tokens |= _tokenize(trigger.lstrip("/"))

        score = 0
        score += len(message_tokens & description_tokens)
        score += 2 * len(message_tokens & when_to_use_tokens)
        score += len(message_tokens & trigger_tokens)
        score += 3 * len(message_tokens & name_tokens)
        return score

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

    def validate_skill_selection(
        self, skill_name: str
    ) -> tuple[SkillDefinition | None, list[str]]:
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
