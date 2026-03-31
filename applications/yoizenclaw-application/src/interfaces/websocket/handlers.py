"""WebSocket message handlers.

Provides handlers for processing incoming WebSocket messages from the backend.
"""

import asyncio
import json
import logging
from typing import Any

from websockets.exceptions import ConnectionClosed

from src.jobs.domain.entities import JobDefinition, JobSyncPayload, JobTriggerPayload
from src.interfaces.websocket.manager import (
    RuntimeConfigStore,
    ConfigurationError,
    get_websocket_manager,
)

logger = logging.getLogger(__name__)


async def _send_event(event: str, payload: dict[str, Any]) -> None:
    """Send an event to the backend via the websocket manager."""
    manager = get_websocket_manager()
    if manager:
        await manager._send_event(event, payload)
    else:
        logger.warning(
            "Cannot send event %s: websocket manager not initialized",
            event,
        )


async def handle_full_sync(payload: dict[str, Any]) -> None:
    """Handle full configuration sync from backend."""
    try:
        await RuntimeConfigStore.update(payload)
        # await _send_event("runtime:config_applied", {
        #     "timestamp": asyncio.get_event_loop().time(),
        #     "status": "success"
        # })
    except ConfigurationError as e:
        logger.error("Configuration error: %s", e)
        # await _send_event("runtime:error", {
        #     "type": "configuration_error",
        #     "message": str(e)
        # })


async def handle_partial_update(payload: dict[str, Any]) -> None:
    """Handle partial configuration update."""
    path = payload.get("path")
    value = payload.get("value")

    if not path:
        logger.error("Partial update missing 'path' field")
        return

    try:
        current = await RuntimeConfigStore.get()
        config_dict = {
            "agent": {
                "system_prompt": current.agent.system_prompt,
                "response_style": current.agent.response_style,
                "tone": current.agent.tone,
                "rules": current.agent.rules,
            },
            "llm": {
                "provider": current.llm.provider,
                "model": current.llm.model,
                "credential_mode": getattr(current.llm, "credential_mode", None),
                "credential_id": current.llm.credential_id,
                "temperature": current.llm.temperature,
                "max_tokens": current.llm.max_tokens,
            },
            "prompts": current.prompts,
            "tools": current.tools,
            "intervals": current.intervals,
        }

        _set_nested_value(config_dict, path, value)
        await RuntimeConfigStore.update(config_dict)

    except RuntimeError:
        logger.error("Cannot apply partial update: no configuration exists")
    except (ConnectionError, TypeError, ValueError) as e:
        logger.error("Error applying partial update: %s", e)


def _set_nested_value(d: dict, path: str, value: Any) -> None:
    """Set a value in a nested dictionary using dot notation."""
    keys = path.split(".")
    for key in keys[:-1]:
        d = d.setdefault(key, {})
    d[keys[-1]] = value


async def handle_agent_reload(payload: dict[str, Any]) -> None:
    """Handle agent reload request."""
    agent_id = payload.get("agent_id")
    logger.info("Reloading agent: %s", agent_id)


async def handle_jobs_sync(payload: dict[str, Any]) -> None:
    """Handle job configuration sync from backend."""
    try:
        from src.jobs.scheduler import get_job_scheduler

        scheduler = get_job_scheduler()
        if not scheduler:
            logger.error("Job scheduler not initialized")
            await _send_event("runtime:error", {
                "type": "job_scheduler_not_initialized",
                "message": "Job scheduler is not available",
            })
            return

        jobs_data = payload.get("jobs", [])
        jobs = [JobDefinition(**job_data) for job_data in jobs_data]

        sync_payload = JobSyncPayload(
            jobs=jobs,
            replace_all=payload.get("replace_all", True),
        )

        result = await scheduler.sync_jobs(sync_payload)

        await _send_event("runtime:jobs_applied", {
            "timestamp": asyncio.get_event_loop().time(),
            "result": result,
        })

    except Exception as e:
        logger.error("Job sync error: %s", e)
        await _send_event("runtime:error", {
            "type": "job_sync_error",
            "message": str(e),
        })


async def handle_job_trigger(payload: dict[str, Any]) -> None:
    """Handle manual job trigger request."""
    try:
        from src.jobs.scheduler import get_job_scheduler

        scheduler = get_job_scheduler()
        if not scheduler:
            logger.error("Job scheduler not initialized")
            return

        trigger_payload = JobTriggerPayload(**payload)
        execution = await scheduler.trigger_job(
            trigger_payload.job_id,
            trigger_payload.event_payload,
        )

        if execution:
            await _send_event("job:triggered", {
                "execution_id": execution.id,
                "job_id": execution.job_id,
                "status": execution.status,
            })
        else:
            await _send_event("runtime:error", {
                "type": "job_not_found",
                "message": f"Job {trigger_payload.job_id} not found",
            })

    except Exception as e:
        logger.error("Job trigger error: %s", e)
        await _send_event("runtime:error", {
            "type": "job_trigger_error",
            "message": str(e),
        })


async def handle_job_cancel(payload: dict[str, Any]) -> None:
    """Handle job cancel request."""
    try:
        from src.jobs.scheduler import get_job_scheduler

        scheduler = get_job_scheduler()
        if not scheduler:
            logger.error("Job scheduler not initialized")
            return

        execution_id = payload.get("execution_id")
        logger.info("Cancel requested for execution: %s", execution_id)

        await _send_event("job:cancelled", {
            "execution_id": execution_id,
        })

    except Exception as e:
        logger.error("Job cancel error: %s", e)
        await _send_event("runtime:error", {
            "type": "job_cancel_error",
            "message": str(e),
        })


async def handle_job_enable(payload: dict[str, Any]) -> None:
    """Handle job enable request."""
    try:
        from src.jobs.scheduler import get_job_scheduler

        scheduler = get_job_scheduler()
        if not scheduler:
            logger.error("Job scheduler not initialized")
            return

        job_id = payload.get("job_id")
        success = await scheduler.enable_job(job_id)

        await _send_event("job:enabled", {
            "job_id": job_id,
            "success": success,
        })

    except Exception as e:
        logger.error("Job enable error: %s", e)
        await _send_event("runtime:error", {
            "type": "job_enable_error",
            "message": str(e),
        })


async def handle_job_disable(payload: dict[str, Any]) -> None:
    """Handle job disable request."""
    try:
        from src.jobs.scheduler import get_job_scheduler

        scheduler = get_job_scheduler()
        if not scheduler:
            logger.error("Job scheduler not initialized")
            return

        job_id = payload.get("job_id")
        success = await scheduler.disable_job(job_id)

        await _send_event("job:disabled", {
            "job_id": job_id,
            "success": success,
        })

    except Exception as e:
        logger.error("Job disable error: %s", e)
        await _send_event("runtime:error", {
            "type": "job_disable_error",
            "message": str(e),
        })


def process_message(message: str) -> None:
    """Process a WebSocket message from backend.
    
    This is a placeholder - actual processing is done inline
    in the manager for now.
    """
    pass
