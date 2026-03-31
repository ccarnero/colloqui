"""Pipeline action executor for multi-step job workflows."""

from __future__ import annotations

from typing import Any

from src.jobs.domain.entities import JobDefinition, JobExecution


async def execute_pipeline(
    job: JobDefinition,
    execution: JobExecution,
) -> dict[str, Any]:
    """Execute a multi-step pipeline action.

    Args:
        job: Job with action_type="pipeline".
        execution: Execution tracking record.

    Returns:
        Dictionary with pipeline outputs and logs.
    """
    from src.jobs.legacy.pipeline import execute_pipeline as run_pipeline

    steps = job.action_config.get("steps", [])
    initial_data = job.action_config.get("initial_data", {})

    if not steps:
        raise ValueError("Pipeline has no steps defined")

    execution.add_log(f"Executing pipeline with {len(steps)} steps")

    result = await run_pipeline(steps, initial_data)

    for log_line in result.get("logs", []):
        execution.add_log(f"  [pipeline] {log_line}")

    if not result.get("success"):
        raise RuntimeError(
            f"Pipeline failed: {result.get('error', 'unknown error')}"
        )

    return result
