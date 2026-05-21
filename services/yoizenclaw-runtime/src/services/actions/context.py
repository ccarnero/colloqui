"""Context building and prompt rendering for job actions."""

from __future__ import annotations

from typing import Any

from src.services.domain.entities import JobExecution


async def build_context(
    context_source: str,
    execution: JobExecution,
) -> dict[str, Any]:
    """Build context data for prompt rendering.

    Args:
        context_source: Source identifier for context data.
        execution: Execution tracking record.

    Returns:
        Dictionary with context data.
    """
    if context_source == "none":
        return {}

    if context_source == "last_24h_conversations":
        execution.add_log("Fetching last 24h conversation context")
        return {"conversations": [], "period": "last_24h"}

    if context_source == "job_execution_history":
        return {"executions": [], "job_id": execution.job_id}

    return {}


async def render_prompt(
    template: str,
    context: dict[str, Any],
    execution: JobExecution,
) -> str:
    """Render a prompt template with context variables.

    Args:
        template: Prompt template string.
        context: Dictionary of context variables.
        execution: Execution tracking record.

    Returns:
        Rendered prompt string.
    """
    try:
        return template.format(**context)
    except KeyError as e:
        execution.add_log(f"Missing template variable: {e}")
        return template
