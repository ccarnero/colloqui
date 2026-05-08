"""Abstract base class for Memory backend implementations."""

from abc import ABC, abstractmethod
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from src.services.domain.entities import JobDefinition, JobExecution


class MemoryBackend(ABC):
    """Abstract base class defining the interface for memory backends.

    All memory implementations must inherit
    from this class and implement its abstract methods.
    """

    @abstractmethod
    async def save_job(self, job: "JobDefinition") -> None:
        """Persist a job definition to the database.

        Args:
            job: JobDefinition to save.
        """
        ...

    @abstractmethod
    async def get_job(self, job_id: str) -> Optional["JobDefinition"]:
        """Retrieve a job definition from the database.

        Args:
            job_id: Unique identifier for the job.

        Returns:
            JobDefinition if found, None otherwise.
        """
        ...

    @abstractmethod
    async def list_jobs(self) -> list["JobDefinition"]:
        """Retrieve all job definitions from the database.

        Returns:
            List of all stored JobDefinitions.
        """
        ...

    @abstractmethod
    async def delete_job(self, job_id: str) -> bool:
        """Delete a job definition from the database.

        Args:
            job_id: Unique identifier for the job.

        Returns:
            True if job was deleted, False if not found.
        """
        ...

    @abstractmethod
    async def save_job_execution(self, execution: "JobExecution") -> None:
        """Persist a job execution record to the database.

        Args:
            execution: JobExecution to save.
        """
        ...

    @abstractmethod
    async def get_job_executions(
        self,
        job_id: str,
        limit: int = 10,
        status: Optional[str] = None,
    ) -> list["JobExecution"]:
        """Retrieve execution history for a specific job.

        Args:
            job_id: Unique identifier for the job.
            limit: Maximum number of executions to return.
            status: Optional filter by execution status.

        Returns:
            List of JobExecution records.
        """
        ...

    @abstractmethod
    async def get_overall_job_metrics(self) -> dict:
        """Get aggregated execution metrics across all jobs.

        Returns:
            Dictionary with aggregated metrics including total_executions,
            successful, failed, cancelled, avg_duration_seconds, success_rate.
        """
        ...

    @abstractmethod
    async def close(self) -> None:
        """Close the connection pool or cleanup resources."""
        ...
