"""LLM call action executor."""

from __future__ import annotations

from typing import Any

from src.jobs.actions.context import build_context, render_prompt
from src.jobs.domain.entities import JobDefinition, JobExecution


async def execute_llm_call(
    job: JobDefinition,
    execution: JobExecution,
    llm_client: Any | None = None,
) -> tuple[dict[str, Any], Any]:
    """Execute LLM call action.

    Args:
        job: Job with action_type="llm_call".
        execution: Execution tracking record.
        llm_client: Optional reusable LLM client instance.

    Returns:
        Tuple of (result dict, llm_client for reuse).
    """
    prompt_template = str(job.action_config.get("prompt", "")).strip()
    if not prompt_template:
        raise ValueError("LLM call action requires a non-empty 'prompt'")

    if not llm_client:
        from src.application.llm.llm_service import LLMClient

        llm_client = LLMClient()

    system_prompt_override = job.action_config.get("system_prompt")
    context_source = job.action_config.get("context", "none")

    execution.add_log(f"Using prompt template: {prompt_template[:50]}...")

    context = await build_context(context_source, execution)
    prompt = await render_prompt(prompt_template, context, execution)

    if system_prompt_override:
        system_prompt = system_prompt_override
    else:
        try:
            from src.shared.config.runtime_config_store import RuntimeConfigStore

            runtime_config = await RuntimeConfigStore.get()
            system_prompt = runtime_config.agent.system_prompt
        except Exception:
            system_prompt = None

    execution.add_log("Calling LLM...")
    response = await llm_client.generate(
        prompt=prompt,
        system_prompt=system_prompt,
    )

    execution.add_log(f"LLM response received from {response.provider}/{response.model}")

    result = {
        "content": response.content,
        "model": response.model,
        "provider": response.provider,
    }
    return result, llm_client
