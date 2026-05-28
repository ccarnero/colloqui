"""MongoDB-based memory for job execution persistence."""

from __future__ import annotations

import logging
from typing import Optional, TYPE_CHECKING

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from src.domain.entities.memory import MemoryBackend
from src.infra.database.memory_store import IMemoryStore, IVectorIndex
from src.infra.database.memory_mongo_jobs import (
    cleanup_old_job_executions as mongo_cleanup_old_job_executions,
    delete_job as mongo_delete_job,
    get_all_jobs as mongo_get_all_jobs,
    get_job as mongo_get_job,
    get_job_executions as mongo_get_job_executions,
    get_job_metrics as mongo_get_job_metrics,
    get_overall_job_metrics as mongo_get_overall_job_metrics,
    get_recent_job_executions as mongo_get_recent_job_executions,
    save_job as mongo_save_job,
    save_job_execution as mongo_save_job_execution,
)
from src.infra.database.memory_mongo_runtime import (
    save_embedding as mongo_save_embedding,
    search_similar_embeddings as mongo_search_similar_embeddings,
)
from src.infra.database.memory_mongo_schema import ensure_schema
from src.utils.config.settings import bootstrap_settings

if TYPE_CHECKING:
    from src.services.domain.entities import JobDefinition, JobExecution

logger = logging.getLogger(__name__)


class MemoryMongoStore(MemoryBackend, IMemoryStore, IVectorIndex):
    """MongoDB-based memory for job and pipeline execution persistence."""

    def __init__(self, mongo_uri: Optional[str] = None) -> None:
        """Initialize the memory store."""

        self.mongo_uri = mongo_uri or bootstrap_settings.mongo_uri
        self._initialized = False
        self._client: AsyncIOMotorClient | None = None
        self._db: AsyncIOMotorDatabase | None = None

    async def initialize(self) -> None:
        """Initialize MongoDB indexes if not already done."""

        if self._initialized:
            return

        self._client = AsyncIOMotorClient(self.mongo_uri)
        self._db = self._client[bootstrap_settings.MONGO_DB]
        await ensure_schema(self._db)
        self._initialized = True

    @property
    def tenant_id(self) -> str:
        """Return the tenant identifier from bootstrap settings."""

        return bootstrap_settings.TENANT_ID

    async def save_job(self, job: "JobDefinition") -> None:
        await self.initialize()
        await mongo_save_job(self.db, self.tenant_id, job)

    async def get_job(self, job_id: str) -> Optional["JobDefinition"]:
        await self.initialize()
        return await mongo_get_job(self.db, self.tenant_id, job_id)

    async def list_jobs(self) -> list["JobDefinition"]:
        return await self.get_all_jobs()

    async def get_all_jobs(self) -> list["JobDefinition"]:
        await self.initialize()
        return await mongo_get_all_jobs(self.db, self.tenant_id)

    async def delete_job(self, job_id: str, hard_delete: bool = False) -> bool:
        await self.initialize()
        return await mongo_delete_job(
            self.db,
            self.tenant_id,
            job_id,
            hard_delete,
        )

    async def save_job_execution(self, execution: "JobExecution") -> None:
        await self.initialize()
        await mongo_save_job_execution(self.db, self.tenant_id, execution)

    async def get_job_executions(
        self,
        job_id: str,
        limit: int = 10,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> tuple[list["JobExecution"], int]:
        await self.initialize()
        return await mongo_get_job_executions(
            self.db,
            self.tenant_id,
            job_id,
            limit,
            offset,
            status,
        )

    async def get_recent_job_executions(
        self,
        limit: int = 50,
        offset: int = 0,
        job_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> tuple[list["JobExecution"], int]:
        await self.initialize()
        return await mongo_get_recent_job_executions(
            self.db,
            self.tenant_id,
            limit,
            offset,
            job_id,
            status,
        )

    async def get_job_metrics(self, job_id: str) -> dict:
        await self.initialize()
        return await mongo_get_job_metrics(self.db, self.tenant_id, job_id)

    async def cleanup_old_job_executions(self, retention_days: int = 30) -> int:
        await self.initialize()
        return await mongo_cleanup_old_job_executions(
            self.db,
            self.tenant_id,
            retention_days,
        )

    async def save_embedding(
        self,
        content: str,
        embedding: list[float],
        metadata: Optional[dict] = None,
    ) -> int:
        await self.initialize()
        return await mongo_save_embedding(
            self.db,
            self.tenant_id,
            content,
            embedding,
            metadata,
        )

    async def search_similar_embeddings(
        self,
        query_embedding: list[float],
        limit: int = 10,
        similarity_threshold: float = 0.7,
    ) -> list[dict]:
        await self.initialize()
        return await mongo_search_similar_embeddings(
            self.db,
            self.tenant_id,
            query_embedding,
            limit,
            similarity_threshold,
        )

    async def get_overall_job_metrics(self) -> dict:
        await self.initialize()
        return await mongo_get_overall_job_metrics(self.db, self.tenant_id)

    async def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            self._db = None
            self._initialized = False

    @property
    def db(self) -> AsyncIOMotorDatabase:
        """Return the initialized MongoDB database."""

        if self._db is None:
            raise RuntimeError("MongoDB database is not initialized")

        return self._db


# Backward-compatible alias for tests and legacy imports.
Memory = MemoryMongoStore
