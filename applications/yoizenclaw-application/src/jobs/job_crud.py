"""Job CRUD and sync operations for the scheduler.

Provides a mixin class with job management methods: add, remove, update,
enable, disable, sync, and internal scheduling helpers.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from src.jobs.domain.entities import JobDefinition, JobSyncPayload

if TYPE_CHECKING:
    from src.jobs.triggers import JobTriggerManager

logger = logging.getLogger(__name__)


class JobCrudMixin:
    """Mixin providing CRUD and sync operations for job management.

    Requires the host class to provide: _lock, _active_jobs, memory,
    _trigger_manager, and _execute_job_wrapper.
    """

    _lock: asyncio.Lock
    _active_jobs: dict[str, JobDefinition]
    _trigger_manager: JobTriggerManager
    memory: Any

    async def sync_jobs(self, payload: JobSyncPayload) -> dict[str, Any]:
        """Synchronize jobs with backend configuration.

        Args:
            payload: JobSyncPayload containing job definitions from backend.

        Returns:
            Summary of changes made.
        """
        added: list[str] = []
        updated: list[str] = []
        removed: list[str] = []

        new_job_ids = {job.id for job in payload.jobs}

        async with self._lock:
            if payload.replace_all:
                for job_id in list(self._active_jobs.keys()):
                    if job_id not in new_job_ids:
                        await self._remove_job_internal(job_id)
                        removed.append(job_id)

            for job in payload.jobs:
                if job.id in self._active_jobs:
                    await self._update_job_internal(job)
                    updated.append(job.id)
                else:
                    await self._schedule_job_internal(job)
                    await self.memory.save_job(job)
                    added.append(job.id)

        logger.info(
            "Job sync complete: %d added, %d updated, %d removed",
            len(added),
            len(updated),
            len(removed),
        )

        return {
            "added": added,
            "updated": updated,
            "removed": removed,
            "total_active": len(self._active_jobs),
        }

    async def add_job(self, job: JobDefinition) -> None:
        """Add a new job to the scheduler.

        Args:
            job: JobDefinition to schedule.
        """
        async with self._lock:
            await self._schedule_job_internal(job)
            await self.memory.save_job(job)

        logger.info("Added job: %s (%s)", job.name, job.id)

    async def remove_job(self, job_id: str) -> bool:
        """Remove a job from the scheduler.

        Args:
            job_id: ID of the job to remove.

        Returns:
            True if job was removed, False if not found.
        """
        async with self._lock:
            if job_id not in self._active_jobs:
                return False
            await self._remove_job_internal(job_id)

        logger.info("Removed job: %s", job_id)
        return True

    async def update_job(self, job: JobDefinition) -> bool:
        """Update an existing job.

        Args:
            job: Updated JobDefinition.

        Returns:
            True if job was updated, False if not found.
        """
        async with self._lock:
            if job.id not in self._active_jobs:
                return False
            await self._update_job_internal(job)

        logger.info("Updated job: %s (%s)", job.name, job.id)
        return True

    async def enable_job(self, job_id: str) -> bool:
        """Enable a previously disabled job.

        Args:
            job_id: ID of the job to enable.

        Returns:
            True if job was enabled, False if not found.
        """
        async with self._lock:
            job = self._active_jobs.get(job_id)
            if not job:
                return False

            if not job.enabled:
                job.enabled = True
                job.updated_at = datetime.now(timezone.utc)
                await self._schedule_job_internal(job)
                await self.memory.save_job(job)

        return True

    async def disable_job(self, job_id: str) -> bool:
        """Disable a job without removing it.

        Args:
            job_id: ID of the job to disable.

        Returns:
            True if job was disabled, False if not found.
        """
        async with self._lock:
            job = self._active_jobs.get(job_id)
            if not job:
                return False

            if job.enabled:
                job.enabled = False
                job.updated_at = datetime.now(timezone.utc)
                self._trigger_manager.unschedule_job(job_id)
                await self.memory.save_job(job)

        return True

    async def get_job(self, job_id: str) -> JobDefinition | None:
        """Get a job definition by ID.

        Args:
            job_id: ID of the job to retrieve.

        Returns:
            JobDefinition if found, None otherwise.
        """
        async with self._lock:
            return self._active_jobs.get(job_id)

    async def get_all_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[JobDefinition], int]:
        """Get all registered jobs with pagination.

        Args:
            limit: Maximum number of jobs to return.
            offset: Number of jobs to skip.

        Returns:
            Tuple of (list of JobDefinitions, total count).
        """
        async with self._lock:
            all_jobs = list(self._active_jobs.values())
            total = len(all_jobs)
            paginated = all_jobs[offset : offset + limit]
            return paginated, total

    async def _schedule_job_internal(self, job: JobDefinition) -> None:
        """Internal method to schedule a job based on its schedule_type.

        Args:
            job: JobDefinition to schedule.
        """
        self._active_jobs[job.id] = job
        if job.enabled:
            self._trigger_manager.schedule_job(job, self._execute_job_wrapper)

    async def _unschedule_job_internal(self, job_id: str) -> None:
        """Internal method to unschedule a job.

        Args:
            job_id: ID of the job to unschedule.
        """
        self._trigger_manager.unschedule_job(job_id)

    async def _remove_job_internal(self, job_id: str) -> None:
        """Internal method to completely remove a job.

        Args:
            job_id: ID of the job to remove.
        """
        await self._unschedule_job_internal(job_id)

        if job_id in self._active_jobs:
            del self._active_jobs[job_id]

        await self.memory.delete_job(job_id)

    async def _update_job_internal(self, job: JobDefinition) -> None:
        """Internal method to update a job.

        Args:
            job: Updated JobDefinition.
        """
        await self._unschedule_job_internal(job.id)

        job.updated_at = datetime.now(timezone.utc)
        self._active_jobs[job.id] = job
        await self.memory.save_job(job)

        if job.enabled:
            await self._schedule_job_internal(job)
