"""Handler for job-related NATS messages."""

from __future__ import annotations

import logging
from typing import Any

from nats.aio.msg import Msg
from opentelemetry import trace

from src.messaging._nats_tracing import TracedNatsHandler
from src.services.domain.entities import JobEventPayload, JobTriggerPayload
from src.services.scheduler import get_job_scheduler
from src.utils.config.settings import bootstrap_settings

import subjects as shared_subjects

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)


def build_subject(action: str) -> str:
    """Build NATS subject for tenant."""
    return shared_subjects.build_subject(bootstrap_settings.TENANT_ID, action)


async def handle_job_trigger(
    message: Msg,
    data: dict[str, Any],
    _envelope: dict[str, Any],
) -> None:
    """Handle job trigger events."""
    scheduler = get_job_scheduler()
    if scheduler is None:
        logger.error("Cannot trigger job: scheduler not initialized")
        return

    subject = build_subject("job_trigger")
    
    with TracedNatsHandler(_tracer, "nats.consume", subject, message) as handler:
        try:
            trigger_payload = JobTriggerPayload(**data)
            execution = await scheduler.trigger_job(
                trigger_payload.job_id,
                trigger_payload.event_payload,
                trigger_payload.execution_id,
            )
            if execution is None:
                logger.warning(
                    "Received trigger for unknown/disabled job %s",
                    trigger_payload.job_id,
                )
            
            handler.set_attribute("job.id", trigger_payload.job_id)
        except Exception as error:
            logger.exception(
                "Failed to trigger job via NATS: %s", error
            )
            raise


async def handle_job_event(
    message: Msg,
    data: dict[str, Any],
    _envelope: dict[str, Any],
) -> None:
    """Handle job event events."""
    scheduler = get_job_scheduler()
    if scheduler is None:
        logger.error("Cannot emit job event: scheduler not initialized")
        return

    subject = build_subject("job.event.emit")
    
    with TracedNatsHandler(_tracer, "nats.consume", subject, message) as handler:
        try:
            event_payload = JobEventPayload(**data)
            triggered = await scheduler.emit_event(
                event_payload.event_name,
                event_payload.event_payload,
            )
            logger.info(
                "Emitted event '%s' to %d job(s)",
                event_payload.event_name,
                triggered,
            )
            
            handler.set_attribute("event.name", event_payload.event_name)
            handler.set_attribute("event.jobs_triggered", triggered)
        except Exception as error:
            logger.exception(
                "Failed to emit job event via NATS: %s", error
            )
            raise
