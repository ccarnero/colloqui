"""Core job scheduler for YoizenClaw.

Manages scheduled, interval-based, and event-driven jobs with persistent
PostgreSQL storage and dynamic configuration updates from backend.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from apscheduler.events import EVENT_JOB_MISSED, JobExecutionEvent
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from src.jobs.execution import JobExecutionEngine
from src.jobs.domain.entities import JobDefinition, JobExecution
from src.jobs.triggers import JobTriggerManager
from src.jobs.job_crud import JobCrudMixin

if TYPE_CHECKING:
    from src.jobs.executor import JobExecutor
    from src.core import create_memory

logger = logging.getLogger(__name__)


class JobScheduler(JobCrudMixin):
    """Manages job scheduling and execution lifecycle.

    Integrates with APScheduler for cron and interval triggers,
    provides event-driven job support, and persists state to PostgreSQL.
    """

    def __init__(
        self,
        memory: Memory,
        executor: JobExecutor | None = None,
    ) -> None:
        """Initialize the job scheduler.

        Args:
            memory: Memory instance for job persistence.
            executor: Optional JobExecutor instance (created if not provided).
        """
        self.memory = memory
        self.scheduler = AsyncIOScheduler()
        self._active_jobs: dict[str, JobDefinition] = {}
        self._executor: JobExecutor | None = executor
        self._running = False
        self._lock = asyncio.Lock()

        self._trigger_manager = JobTriggerManager(self.scheduler)
        self._execution_engine: JobExecutionEngine | None = (
            JobExecutionEngine(executor, self.memory) if executor is not None else None
        )

    def set_executor(self, executor: JobExecutor) -> None:
        """Set the job executor (required before starting scheduler)."""
        self._executor = executor
        self._execution_engine = JobExecutionEngine(executor, self.memory)

    async def initialize(self) -> None:
        """Initialize scheduler and load persisted jobs from database."""
        logger.info("Initializing job scheduler")

        stored_jobs = await self.memory.get_all_jobs()

        async with self._lock:
            for job in stored_jobs:
                if job.enabled:
                    await self._schedule_job_internal(job)
                else:
                    self._active_jobs[job.id] = job

        logger.info("Loaded %d jobs from database", len(stored_jobs))

    async def start(self) -> None:
        """Start the scheduler."""
        if self._executor is None:
            raise RuntimeError("JobExecutor must be set before starting scheduler")

        if not self._running:
            self.scheduler.add_listener(self._on_job_missed, EVENT_JOB_MISSED)
            self.scheduler.start()
            self._running = True
            logger.info("Job scheduler started")

    async def stop(self) -> None:
        """Stop the scheduler and shutdown APScheduler."""
        if self._running:
            self.scheduler.shutdown(wait=True)
            self._running = False
            logger.info("Job scheduler stopped")

    async def trigger_job(
        self,
        job_id: str,
        event_payload: dict[str, Any] | None = None,
        execution_id: str | None = None,
    ) -> JobExecution | None:
        """Manually trigger a job execution.

        Args:
            job_id: ID of the job to trigger.
            event_payload: Optional payload for event-driven jobs.
            execution_id: Optional externally assigned execution id.

        Returns:
            JobExecution if job was found and triggered, None otherwise.
        """
        async with self._lock:
            job = self._active_jobs.get(job_id)
            if not job or not job.enabled:
                return None

            execution = JobExecution(
                id=execution_id or str(uuid4()),
                job_id=job_id,
                triggered_by="manual",
                event_payload=event_payload,
            )

            if self._execution_engine:
                asyncio.create_task(
                    self._safe_trigger_execute(job, execution)
                )

            return execution

    async def _safe_trigger_execute(
        self,
        job: JobDefinition,
        execution: JobExecution,
    ) -> None:
        """Execute job with error logging.

        Args:
            job: JobDefinition to execute.
            execution: JobExecution tracking record.
        """
        try:
            await self._execution_engine.execute_job(job, execution)
        except Exception as e:
            logger.error("Triggered job %s failed: %s", job.id, e)

    def _on_job_missed(self, event: JobExecutionEvent) -> None:
        """APScheduler listener called when a scheduled run is missed.

        Saves a 'skipped' execution record so the miss is visible in
        job history and metrics.

        Args:
            event: APScheduler job execution event with misfire details.
        """
        job_id = event.job_id
        scheduled_at = event.scheduled_run_time
        logger.warning(
            "Job '%s' misfire at %s — recording as skipped",
            job_id,
            scheduled_at,
        )
        execution = JobExecution(
            job_id=job_id,
            status="skipped",
            triggered_by="schedule",
            started_at=scheduled_at,
            finished_at=scheduled_at,
            error_message="Missed scheduled run (misfire)",
        )
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.memory.save_job_execution(execution))
        except RuntimeError:
            asyncio.create_task(self.memory.save_job_execution(execution))

    async def _execute_job_wrapper(self, job_id: str) -> None:
        """Wrapper called by APScheduler to execute a job.

        Args:
            job_id: ID of the job to execute.
        """
        job = self._active_jobs.get(job_id)
        if not job or not job.enabled:
            return

        execution = JobExecution(
            job_id=job_id,
            triggered_by="schedule",
        )

        if self._execution_engine:
            await self._execution_engine.execute_job(job, execution)

    def register_event_job(self, job: JobDefinition) -> None:
        """Register an event-driven job.

        Args:
            job: JobDefinition with schedule_type="event".
        """
        if job.schedule_type == "event":
            self._trigger_manager._register_event_job(job)

    async def emit_event(self, event_name: str, payload: dict[str, Any]) -> int:
        """Emit an event to trigger event-driven jobs.

        Args:
            event_name: Name of the event.
            payload: Event data payload.
        """
        jobs = self._trigger_manager.get_event_jobs(event_name)

        enabled_jobs = [job for job in jobs if job.enabled]

        if self._execution_engine:
            await self._execution_engine.trigger_event_jobs(
                event_name,
                payload,
                enabled_jobs,
                self._execution_engine.execute_job,
            )

        if enabled_jobs:
            logger.debug(
                "Emitted event '%s' to %d jobs",
                event_name,
                len(enabled_jobs),
            )

        return len(enabled_jobs)

    def get_event_job_names(self) -> list[str]:
        """Get list of event names that have registered jobs.

        Returns:
            List of event names.
        """
        return self._trigger_manager.get_all_event_names()

    async def get_job_executions(
        self,
        job_id: str,
        limit: int = 10,
        offset: int = 0,
    ) -> tuple[list[JobExecution], int]:
        """Get execution history for a job.

        Args:
            job_id: ID of the job.
            limit: Maximum number of executions to return.
            offset: Number of executions to skip.

        Returns:
            Tuple of (list of JobExecution records, total count).
        """
        return await self.memory.get_job_executions(job_id, limit=limit, offset=offset)

    async def get_recent_job_executions(
        self,
        limit: int = 50,
        offset: int = 0,
        job_id: str | None = None,
        status: str | None = None,
    ) -> tuple[list[JobExecution], int]:
        """Get recent executions across all jobs or a single job with pagination."""
        return await self.memory.get_recent_job_executions(
            limit=limit,
            offset=offset,
            job_id=job_id,
            status=status,
        )

    async def get_job_metrics(self, job_id: str) -> dict[str, Any]:
        """Get execution metrics for a specific job."""
        return await self.memory.get_job_metrics(job_id)

    async def get_overall_job_metrics(self) -> dict[str, Any]:
        """Get aggregated metrics across all jobs."""
        return await self.memory.get_overall_job_metrics()


async def create_job_scheduler(memory) -> JobScheduler:
    """Create and initialize the global job scheduler.

    Args:
        memory: Memory instance for persistence.

    Returns:
        Initialized JobScheduler instance.
    """
    from src.jobs.executor import JobExecutor
    from src.shared.di import AppContainer

    executor = JobExecutor()
    scheduler = JobScheduler(memory=memory, executor=executor)
    await scheduler.initialize()
    AppContainer.get().job_scheduler = scheduler

    return scheduler


async def start_job_scheduler() -> None:
    """Start the global job scheduler."""
    from src.shared.di import AppContainer

    scheduler = AppContainer.get().job_scheduler
    if scheduler:
        await scheduler.start()


async def stop_job_scheduler() -> None:
    """Stop the global job scheduler."""
    from src.shared.di import AppContainer

    scheduler = AppContainer.get().job_scheduler
    if scheduler:
        await scheduler.stop()
    AppContainer.get().job_scheduler = None


def get_job_scheduler() -> JobScheduler | None:
    """Get the global job scheduler instance.

    Returns:
        JobScheduler instance if initialized, None otherwise.
    """
    from src.shared.di import AppContainer

    return AppContainer.get().job_scheduler
