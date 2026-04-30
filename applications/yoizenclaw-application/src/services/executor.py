"""Job executor engine for YoizenClaw.

Dispatches job actions to specialized handlers in the actions sub-package.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from src.services.actions.function_action import execute_function, get_default_functions
from src.services.actions.llm_action import execute_llm_call
from src.services.actions.python_action import execute_python_code
from src.services.actions.webhook_action import (
    close_webhook_client,
    execute_webhook,
    get_webhook_client,
)
from src.services.domain.entities import JobDefinition, JobExecution

logger = logging.getLogger(__name__)

__all__ = [
    "JobExecutor",
    "get_webhook_client",
    "close_webhook_client",
]


class JobExecutor:
    """Executes job actions based on action_type.

    Supports multiple action types:
    - llm_call: Generate text using configured LLM
    - python_code: Execute Python code in sandboxed environment
    - webhook: Make HTTP requests to external APIs
    - function: Call registered internal functions
    """

    def __init__(self) -> None:
        """Initialize the job executor."""
        self._llm_client: Any | None = None
        self._functions: dict[str, Callable] = get_default_functions()

    async def execute(
        self,
        job: JobDefinition,
        execution: JobExecution,
    ) -> dict[str, Any]:
        """Execute a job's action.

        Args:
            job: JobDefinition containing action configuration.
            execution: JobExecution for tracking progress.

        Returns:
            Dictionary with execution results.

        Raises:
            Exception: If action execution fails.
        """
        execution.add_log(f"Executing action type: {job.action_type}")

        if job.action_type == "llm_call":
            result, self._llm_client = await execute_llm_call(
                job, execution, self._llm_client
            )
            return result
        elif job.action_type == "python_code":
            return await execute_python_code(job, execution)
        elif job.action_type == "webhook":
            return await execute_webhook(job, execution)
        elif job.action_type == "function":
            return await execute_function(
                job.action_config.get("function", ""),
                job.action_config.get("parameters", {}),
                self._functions,
                execution,
            )
        else:
            raise ValueError(f"Unknown action type: {job.action_type}")

    def register_function(self, name: str, func: Callable) -> None:
        """Register a custom function for job use.

        Args:
            name: Function name as used in job configuration.
            func: Callable function to execute.
        """
        self._functions[name] = func
        logger.info("Registered job function: %s", name)

    def unregister_function(self, name: str) -> bool:
        """Unregister a custom function.

        Args:
            name: Function name to unregister.

        Returns:
            True if function was removed, False if not found.
        """
        if name in self._functions:
            del self._functions[name]
            return True
        return False
