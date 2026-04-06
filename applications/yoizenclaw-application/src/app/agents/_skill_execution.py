"""Skill execution helpers for Agent class."""

from __future__ import annotations

from typing import Any

from src.app.llm.llm_service import LLMClient, LLMDeps
from src.app.agents.prompt_references import parse_prompt_references
from src.utils.config.settings import bootstrap_settings


def resolve_skill(
    skill_name: str | None,
    skills: list[dict[str, Any]],
    system_prompt_refs: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any] | None:
    """Resolve and validate a skill configuration.

    Args:
        skill_name: Optional skill name to select
        skills: Available skill configurations
        system_prompt_refs: Parsed prompt references
        warnings: List to append warnings to

    Returns:
        Selected skill configuration or None if no skill found
    """
    if not skills:
        return None

    if skill_name:
        # Select specific skill by name
        for skill in skills:
            if skill.get("name") == skill_name:
                return skill
        warnings.append(f"Skill '{skill_name}' not found, using first available")

    # Auto-select based on prompt references or use first skill
    if system_prompt_refs.get("skill_references"):
        for skill_name in system_prompt_refs["skill_references"]:
            for skill in skills:
                if skill.get("name") == skill_name:
                    return skill
        warnings.append(
            f"Referenced skill '{skill_name}' not found, using first available"
        )

    return skills[0]


async def execute_skill_with_llm(
    skill: dict[str, Any],
    state: dict[str, Any],
    user_prompt: str,
    llm_client: LLMClient,
    tool_calls: list[dict[str, Any]],
    system_prompt_refs: dict[str, Any],
) -> dict[str, Any]:
    """Execute a skill using the LLM client.

    Args:
        skill: Skill configuration
        state: Runtime execution state
        user_prompt: User prompt
        llm_client: LLM client instance
        tool_calls: List to capture tool calls
        system_prompt_refs: Parsed prompt references

    Returns:
        Execution result with response and state
    """
    from pydantic_ai import Agent as PydanticAgent

    # Build skill instructions
    instructions_parts = [skill.get("instructions", "")]
    if system_prompt_refs.get("tool_references"):
        tool_names = ", ".join(system_prompt_refs["tool_references"])
        instructions_parts.append(f"Available tools: {tool_names}")

    instructions = "\n\n".join(filter(None, instructions_parts))

    # Create skill agent with allowed tools
    skill_agent = PydanticAgent(
        llm_client._get_pydantic_model(),
        instructions=instructions,
    )

    # Execute skill
    response = await skill_agent.run(
        user_prompt,
        deps=LLMDeps(
            tenant_id=bootstrap_settings.TENANT_ID or "default",
            agent_id="skill-executor",
            tool_registry=llm_client.tool_registry,
        ),
    )

    return {
        "response": response.content,
        "tool_calls": tool_calls,
        "state": state,
    }
