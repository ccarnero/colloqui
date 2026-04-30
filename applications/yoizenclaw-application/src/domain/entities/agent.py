"""Agent domain entity - pure business logic."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class Agent(BaseModel):
    """Agent domain entity representing an AI agent configuration."""
    
    id: str | None = None
    name: str
    system_prompt: str
    description: str | None = None
    llm_config: dict[str, Any] = Field(default_factory=dict)
    tools: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)
    enabled: bool = True
    
    metadata: dict[str, Any] = Field(default_factory=dict)
    
    def is_configured(self) -> bool:
        """Check if agent has the minimum required configuration."""
        return bool(self.system_prompt and self.llm_config)
    
    def get_tool_names(self) -> list[str]:
        """Get list of tool names configured for this agent."""
        return [tool.get("name", "") for tool in self.tools if tool.get("name")]
    
    def get_skill_names(self) -> list[str]:
        """Get list of skill names configured for this agent."""
        return [skill.get("name", "") for skill in self.skills if skill.get("name")]
