"""Skill definition model for intelligent skill routing.

Replaces the legacy AgentSkillPayload with a rich model that includes
when_to_use guidance, triggers, arguments, and execution modes.
"""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field, validator


class SkillDefinition(BaseModel):
    """Definition of a skill with rich metadata for intelligent routing.

    Replaces AgentSkillPayload with enhanced fields for LLM-driven
    skill selection and execution.
    """

    id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_-]+$",
        description="Unique identifier for the skill",
    )
    name: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Human-readable skill name",
    )
    description: str = Field(
        ...,
        min_length=1,
        description="Skill description for documentation",
    )
    enabled: bool = Field(default=True, description="Whether the skill is active")
    instructions: str = Field(
        default="", description="System prompt instructions for this skill"
    )

    # NEW: Intelligent routing fields
    when_to_use: str = Field(
        default="",
        description="Natural language guidance for the LLM on when to use this skill",
    )
    triggers: list[str] = Field(
        default_factory=list,
        description="Command triggers (e.g., ['/sales', '/help']) for explicit activation",
    )
    arguments: list[str] = Field(
        default_factory=list,
        description="Named arguments this skill accepts (e.g., ['env', 'version'])",
    )

    # Enhanced execution options
    allowed_tools: list[str] = Field(
        default_factory=list, description="List of tool names this skill can use"
    )
    context_mode: Literal["inline", "fork"] = Field(
        default="inline",
        description="Execution mode: inline (same context) or fork (isolated agent)",
    )
    model_override: str | None = Field(
        default=None,
        description="Optional model override for this skill (e.g., 'claude-3-haiku')",
    )
    priority: int = Field(
        default=0,
        description="Priority for fallback selection (higher = more preferred)",
    )

    # Legacy compatibility
    config: dict[str, Any] = Field(
        default_factory=dict, description="Additional configuration"
    )

    @validator("when_to_use")
    def validate_when_to_use(cls, v: str) -> str:
        """Ensure when_to_use is a clean string."""
        if isinstance(v, str):
            return v.strip()
        return str(v).strip()

    @validator("triggers")
    def validate_triggers(cls, v: list[str]) -> list[str]:
        """Normalize triggers to clean strings."""
        return [
            trigger.strip()
            for trigger in v
            if isinstance(trigger, str) and trigger.strip()
        ]

    @validator("arguments")
    def validate_arguments(cls, v: list[str]) -> list[str]:
        """Normalize arguments to clean strings."""
        return [arg.strip() for arg in v if isinstance(arg, str) and arg.strip()]

    @validator("allowed_tools")
    def validate_allowed_tools(cls, v: list[str]) -> list[str]:
        """Normalize allowed_tools to clean strings."""
        return [tool.strip() for tool in v if isinstance(tool, str) and tool.strip()]

    def has_trigger(self, message: str) -> bool:
        """Check if the message starts with any of this skill's triggers."""
        message_stripped = message.strip()
        for trigger in self.triggers:
            if message_stripped.startswith(trigger):
                return True
        return False

    def get_trigger_used(self, message: str) -> str | None:
        """Return the trigger that was used, or None if none matched."""
        message_stripped = message.strip()
        for trigger in self.triggers:
            if message_stripped.startswith(trigger):
                return trigger
        return None

    def is_higher_priority(self, other: SkillDefinition) -> bool:
        """Check if this skill has higher priority than another."""
        return self.priority > other.priority

    def get_summary_for_llm(self) -> str:
        """Get a concise summary for LLM selection."""
        parts = []

        if self.when_to_use:
            parts.append(f"Use when: {self.when_to_use}")

        if self.triggers:
            parts.append(f"Triggers: {', '.join(self.triggers)}")

        if self.arguments:
            parts.append(f"Arguments: {', '.join(self.arguments)}")

        if self.description:
            parts.append(f"Description: {self.description}")

        return " | ".join(parts)

    class Config:
        """Pydantic configuration."""

        extra = "allow"  # Allow additional fields for backward compatibility
