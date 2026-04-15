"""Skill execution helpers for Agent class."""

from __future__ import annotations

from typing import Any

from src.app.llm.llm_service import LLMClient, LLMDeps
from src.app.agents.prompt_references import parse_prompt_references
from src.utils.config.settings import bootstrap_settings


def _extract_run_text(result: Any) -> str:
    """Extract plain text from pydantic-ai run results.

    Newer pydantic-ai versions expose text on ``output`` while legacy stubs may
    still expose ``content``.
    """
    output_value = getattr(result, "output", None)
    if isinstance(output_value, str):
        return output_value

    content_value = getattr(result, "content", None)
    if isinstance(content_value, str):
        return content_value

    return str(output_value or content_value or "")


def resolve_skill(
    skill_name: str | None,
    skills: list[dict[str, Any]],
    system_prompt_refs: Any,
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
    prompt_skill_references = _extract_prompt_skill_references(system_prompt_refs)
    if prompt_skill_references:
        for referenced_skill_name in prompt_skill_references:
            for skill in skills:
                if skill.get("name") == referenced_skill_name:
                    return skill
        warnings.append(
            "Referenced skill "
            f"'{prompt_skill_references[0]}' not found, using first available"
        )

    return skills[0]


def _extract_prompt_skill_references(system_prompt_refs: Any) -> list[str]:
    """Extract skill references from either dict or PromptReferenceResult."""
    if isinstance(system_prompt_refs, dict):
        raw_references = system_prompt_refs.get("skill_references")
    else:
        raw_references = getattr(system_prompt_refs, "skill_references", None)

    if not isinstance(raw_references, (list, tuple)):
        return []

    return [
        str(item).strip()
        for item in raw_references
        if isinstance(item, str) and item.strip()
    ]


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
        instructions_parts.append(f"Prompt-referenced tools: {tool_names}.")

    configured_allowed_tools = skill.get("allowed_tools")
    if not isinstance(configured_allowed_tools, list):
        configured_allowed_tools = skill.get("allowedTools")

    allowed_tools = []
    if isinstance(configured_allowed_tools, list):
        allowed_tools = [
            str(tool_name).strip()
            for tool_name in configured_allowed_tools
            if isinstance(tool_name, str) and str(tool_name).strip()
        ]

    if allowed_tools:
        instructions_parts.append(
            (
                "Use tools when external data or actions are required. "
                f"Allowed tools: {', '.join(allowed_tools)}."
            )
        )

    instructions = "\n\n".join(filter(None, instructions_parts))

    await llm_client._ensure_credentials()
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
        "response": _extract_run_text(response),
        "tool_calls": tool_calls,
        "state": state,
    }
