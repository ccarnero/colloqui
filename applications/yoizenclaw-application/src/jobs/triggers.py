"""Job trigger handling for YoizenClaw scheduler.

Manages different schedule types: cron, interval, event, and manual.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

MISFIRE_GRACE_SECONDS = 30

if TYPE_CHECKING:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from src.jobs.domain.entities import JobDefinition

logger = logging.getLogger(__name__)


class JobTriggerManager:
    """Manages job scheduling based on trigger types."""

    def __init__(self, scheduler: AsyncIOScheduler) -> None:
        """Initialize the trigger manager.

        Args:
            scheduler: APScheduler instance to use for scheduling.
        """
        self.scheduler = scheduler
        self._event_jobs: dict[str, list[JobDefinition]] = {}

    def schedule_job(self, job: JobDefinition, job_wrapper: callable) -> None:
        """Schedule a job based on its schedule_type.

        Args:
            job: JobDefinition to schedule.
            job_wrapper: Wrapper function to call when job triggers.
        """
        if job.schedule_type == "cron":
            self._schedule_cron_job(job, job_wrapper)
        elif job.schedule_type == "interval":
            self._schedule_interval_job(job, job_wrapper)
        elif job.schedule_type == "event":
            self._register_event_job(job)
        elif job.schedule_type == "manual":
            # Manual jobs are not scheduled, just stored
            pass

    def _schedule_cron_job(self, job: JobDefinition, job_wrapper: callable) -> None:
        """Schedule a cron-based job.

        Args:
            job: JobDefinition with schedule_type="cron".
            job_wrapper: Wrapper function to call when job triggers.
        """
        expression = job.schedule_config.get("expression", "0 0 * * *")
        self.scheduler.add_job(
            func=job_wrapper,
            trigger=CronTrigger.from_crontab(expression),
            args=[job.id],
            id=job.id,
            replace_existing=True,
            max_instances=1,
            misfire_grace_time=MISFIRE_GRACE_SECONDS,
            coalesce=True,
        )
        logger.debug("Scheduled cron job %s with expression %s", job.id, expression)

    def _schedule_interval_job(self, job: JobDefinition, job_wrapper: callable) -> None:
        """Schedule an interval-based job.

        Args:
            job: JobDefinition with schedule_type="interval".
            job_wrapper: Wrapper function to call when job triggers.
        """
        seconds = job.schedule_config.get("seconds", 3600)
        self.scheduler.add_job(
            func=job_wrapper,
            trigger=IntervalTrigger(seconds=seconds),
            args=[job.id],
            id=job.id,
            replace_existing=True,
            max_instances=1,
            misfire_grace_time=MISFIRE_GRACE_SECONDS,
            coalesce=True,
        )
        logger.debug("Scheduled interval job %s with %ds interval", job.id, seconds)

    def _register_event_job(self, job: JobDefinition) -> None:
        """Register an event-driven job.

        Args:
            job: JobDefinition with schedule_type="event".
        """
        event_name = job.schedule_config.get("event_name", "default")
        if event_name not in self._event_jobs:
            self._event_jobs[event_name] = []

        # Remove existing registration if present
        self._event_jobs[event_name] = [
            j for j in self._event_jobs[event_name] if j.id != job.id
        ]
        self._event_jobs[event_name].append(job)
        logger.debug("Registered event job %s for event '%s'", job.id, event_name)

    def unschedule_job(self, job_id: str) -> None:
        """Remove a job from scheduling.

        Args:
            job_id: ID of the job to unschedule.
        """
        try:
            self.scheduler.remove_job(job_id)
        except Exception:
            # Job may not have been scheduled (e.g., manual or event jobs)
            pass

        # Remove from event jobs if present
        for event_jobs in self._event_jobs.values():
            event_jobs[:] = [j for j in event_jobs if j.id != job_id]

    def get_event_jobs(self, event_name: str) -> list[JobDefinition]:
        """Get jobs registered for a specific event.

        Args:
            event_name: Name of the event.

        Returns:
            List of JobDefinitions registered for the event.
        """
        return self._event_jobs.get(event_name, [])

    def get_all_event_names(self) -> list[str]:
        """Get all event names with registered jobs.

        Returns:
            List of event names.
        """
        return list(self._event_jobs.keys())
