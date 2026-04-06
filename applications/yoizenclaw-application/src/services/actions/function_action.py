"""Function action executor with built-in function registry."""

from __future__ import annotations

import logging
from typing import Any, Callable

from src.services.domain.entities import JobExecution

logger = logging.getLogger(__name__)


async def cleanup_old_conversations(retention_days: int = 30) -> dict[str, Any]:
    """Clean up old conversation data.

    Args:
        retention_days: Keep conversations newer than this many days.

    Returns:
        Dictionary with cleanup results.
    """
    logger.info("Cleaning up conversations older than %d days", retention_days)
    return {"deleted_count": 0}


async def get_conversation_metrics() -> dict[str, Any]:
    """Get conversation metrics.

    Returns:
        Dictionary with metrics.
    """
    return {
        "total_conversations": 0,
        "active_today": 0,
        "average_duration": 0,
    }


async def export_data(format_type: str = "json") -> dict[str, Any]:
    """Export data to file.

    Args:
        format_type: Export format (json, csv).

    Returns:
        Dictionary with export results.
    """
    return {"format": format_type, "location": "/tmp/export.json"}


async def notify_backend(message: str) -> dict[str, Any]:
    """Send notification to admin via NATS.

    Args:
        message: Notification message.

    Returns:
        Dictionary with notification results.
    """
    try:
        from src.messaging.bridge import publish_runtime_event

        await publish_runtime_event(
            "job.notification",
            {"message": message},
        )
        return {"sent": True}
    except Exception as e:
        return {"sent": False, "error": str(e)}


def get_default_functions() -> dict[str, Callable]:
    """Return built-in functions available to jobs.

    Returns:
        Dictionary mapping function names to callables.
    """
    return {
        "cleanup_old_conversations": cleanup_old_conversations,
        "get_conversation_metrics": get_conversation_metrics,
        "export_data": export_data,
        "notify_backend": notify_backend,
    }


async def execute_function(
    function_name: str,
    parameters: dict[str, Any],
    functions: dict[str, Callable],
    execution: JobExecution,
) -> dict[str, Any]:
    """Execute registered function action.

    Args:
        function_name: Name of the registered function.
        parameters: Parameters to pass to the function.
        functions: Registry of available functions.
        execution: Execution tracking record.

    Returns:
        Dictionary with function results.
    """
    execution.add_log(f"Calling function: {function_name}")

    if function_name not in functions:
        raise ValueError(f"Unknown function: {function_name}")

    func = functions[function_name]
    result = await func(**parameters)

    execution.add_log(f"Function {function_name} executed successfully")

    return {"result": result}
