"""Repository interfaces for job domain.

Defines contracts for job persistence and retrieval without implementation details.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from src.jobs.domain.entities import JobDefinition, JobExecution, JobSyncPayload


class IJobRepository(ABC):
    """Interface for job definition persistence."""

    @abstractmethod
    async def save_job(self, job: JobDefinition) -> JobDefinition:
        """Save or update a job definition."""
        pass

    @abstractmethod
    async def get_job(self, job_id: str) -> Optional[JobDefinition]:
        """Retrieve a job by ID."""
        pass

    @abstractmethod
    async def get_all_jobs(self) -> list[JobDefinition]:
        """Retrieve all job definitions."""
        pass

    @abstractmethod
    async def get_enabled_jobs(self) -> list[JobDefinition]:
        """Retrieve only enabled job definitions."""
        pass

    @abstractmethod
    async def delete_job(self, job_id: str) -> bool:
        """Delete a job by ID."""
        pass

    @abstractmethod
    async def sync_jobs(self, payload: JobSyncPayload) -> None:
        """Sync jobs from backend payload."""
        pass


class IJobExecutionRepository(ABC):
    """Interface for job execution tracking."""

    @abstractmethod
    async def save_execution(self, execution: JobExecution) -> JobExecution:
        """Save or update a job execution record."""
        pass

    @abstractmethod
    async def get_execution(self, execution_id: str) -> Optional[JobExecution]:
        """Retrieve an execution by ID."""
        pass

    @abstractmethod
    async def get_executions_by_job(self, job_id: str, limit: int = 50) -> list[JobExecution]:
        """Retrieve executions for a specific job."""
        pass

    @abstractmethod
    async def get_pending_executions(self) -> list[JobExecution]:
        """Retrieve all pending executions."""
        pass

    @abstractmethod
    async def get_running_executions(self) -> list[JobExecution]:
        """Retrieve all running executions."""
        pass


class IJobScheduler(ABC):
    """Interface for job scheduling operations."""

    @abstractmethod
    async def start(self) -> None:
        """Start the job scheduler."""
        pass

    @abstractmethod
    async def stop(self) -> None:
        """Stop the job scheduler."""
        pass

    @abstractmethod
    async def schedule_job(self, job: JobDefinition) -> None:
        """Schedule a job for execution."""
        pass

    @abstractmethod
    async def unschedule_job(self, job_id: str) -> None:
        """Remove a job from scheduling."""
        pass

    @abstractmethod
    async def trigger_job(self, job_id: str, context: Optional[dict[str, Any]] = None) -> JobExecution:
        """Manually trigger a job execution."""
        pass

    @abstractmethod
    async def get_scheduler_status(self) -> dict[str, Any]:
        """Get current scheduler status."""
        pass


class IJobExecutor(ABC):
    """Interface for job execution."""

    @abstractmethod
    async def execute_job(self, job: JobDefinition, context: Optional[dict[str, Any]] = None) -> JobExecution:
        """Execute a job and return the execution record."""
        pass

    @abstractmethod
    async def cancel_execution(self, execution_id: str) -> bool:
        """Cancel a running job execution."""
        pass
