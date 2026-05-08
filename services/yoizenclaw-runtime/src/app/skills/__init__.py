"""Skills package for intelligent skill routing.

This package provides the new skill routing system with:
- SkillDefinition model with when_to_use guidance
- SkillRouter for intelligent selection
- Discovery tools for LLM-driven skill activation
- Argument substitution and execution modes
"""

from .skill_def import SkillDefinition

__all__ = ["SkillDefinition"]
