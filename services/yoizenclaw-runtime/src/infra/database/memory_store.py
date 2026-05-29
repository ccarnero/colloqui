"""Storage engine protocols for yoizenclaw-runtime persistence."""

from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable, TYPE_CHECKING

if TYPE_CHECKING:
    from src.services.domain.entities import JobDefinition, JobExecution


@runtime_checkable
class IMemoryStore(Protocol):
    """Job persistence and runtime state store (postgres or mongo)."""

    @property
    def tenant_id(self) -> str:
        """Return the tenant identifier from bootstrap settings."""
        ...

    async def initialize(self) -> None:
        """Ensure the backend connection and schema are ready."""
        ...

    async def close(self) -> None:
        """Close connections and release resources."""
        ...

    async def save_job(self, job: JobDefinition) -> None:
        ...

    async def get_job(self, job_id: str) -> Optional[JobDefinition]:
        ...

    async def list_jobs(self) -> list[JobDefinition]:
        ...

    async def get_all_jobs(self) -> list[JobDefinition]:
        ...

    async def delete_job(self, job_id: str, hard_delete: bool = False) -> bool:
        ...

    async def save_job_execution(self, execution: JobExecution) -> None:
        ...

    async def get_job_executions(
        self,
        job_id: str,
        limit: int = 10,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> tuple[list[JobExecution], int]:
        ...

    async def get_recent_job_executions(
        self,
        limit: int = 50,
        offset: int = 0,
        job_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> tuple[list[JobExecution], int]:
        ...

    async def get_job_metrics(self, job_id: str) -> dict:
        ...

    async def cleanup_old_job_executions(self, retention_days: int = 30) -> int:
        ...

    async def get_overall_job_metrics(self) -> dict:
        ...


@runtime_checkable
class IVectorIndex(Protocol):
    """Vector similarity search (pgvector or mongo atlas / dev fallback)."""

    async def save_embedding(
        self,
        content: str,
        embedding: list[float],
        metadata: Optional[dict] = None,
    ) -> int:
        ...

    async def search_similar_embeddings(
        self,
        query_embedding: list[float],
        limit: int = 10,
        similarity_threshold: float = 0.7,
    ) -> list[dict]:
        ...


@runtime_checkable
class ILeaderElection(Protocol):
    """Scheduler leader election lease (advisory lock or TTL document)."""

    async def acquire(self) -> bool:
        """Try to acquire the scheduler leader lease."""
        ...

    async def release(self) -> None:
        """Release the scheduler leader lease if held."""
        ...
