"""PostgreSQL-based memory for job execution persistence.

Provides persistent storage for job definitions, execution history, and embeddings
using PostgreSQL with asyncpg for async operations and pgvector for vector support.
"""

import asyncpg
import json
import logging
from typing import Optional, TYPE_CHECKING

from src.domain.entities.memory import MemoryBackend
from src.utils.config.settings import bootstrap_settings
from src.infra.database.memory_postgres_schema import (
    SCHEMA_SQL,
    SCHEMA_COMPAT_ALTER_SQL,
    RUNTIME_STATE_SCHEMA_SQL,
    RUNTIME_STATE_ALTER_SQL,
)
from src.infra.database.memory_postgres_jobs import (
    save_job as pg_save_job,
    get_job as pg_get_job,
    get_all_jobs as pg_get_all_jobs,
    delete_job as pg_delete_job,
    save_job_execution as pg_save_job_execution,
    get_job_executions as pg_get_job_executions,
    get_recent_job_executions as pg_get_recent_job_executions,
    get_job_metrics as pg_get_job_metrics,
    get_overall_job_metrics as pg_get_overall_job_metrics,
    cleanup_old_job_executions as pg_cleanup_old_job_executions,
)
from src.infra.database.memory_postgres_runtime import (
    save_embedding as pg_save_embedding,
    search_similar_embeddings as pg_search_similar_embeddings,
)

if TYPE_CHECKING:
    from src.services.domain.entities import JobDefinition, JobExecution

logger = logging.getLogger(__name__)


class Memory(MemoryBackend):
    """PostgreSQL-based memory for job and pipeline execution persistence."""

    def __init__(self, connection_string: Optional[str] = None) -> None:
        """Initialize the memory store.

        Args:
            connection_string: PostgreSQL connection string. If None, builds from env vars.
        """
        if connection_string:
            self.connection_string = connection_string
        else:
            database_url = bootstrap_settings.DATABASE_URL
            if database_url:
                self.connection_string = database_url
            else:
                self.connection_string = bootstrap_settings.postgres_connection_string
        self._initialized = False
        self._pool: Optional[asyncpg.Pool] = None

    async def initialize(self) -> None:
        """Initialize the database schema if not already done."""
        if self._initialized:
            return

        async def _init_connection(conn: asyncpg.Connection) -> None:
            """Register JSON/JSONB codecs so dicts pass through transparently."""
            await conn.set_type_codec(
                "jsonb",
                encoder=json.dumps,
                decoder=json.loads,
                schema="pg_catalog",
            )
            await conn.set_type_codec(
                "json",
                encoder=json.dumps,
                decoder=json.loads,
                schema="pg_catalog",
            )

        self._pool = await asyncpg.create_pool(
            self.connection_string,
            min_size=2,
            max_size=10,
            init=_init_connection,
            ssl="prefer",
        )

        async with self._pool.acquire() as conn:
            await conn.execute(SCHEMA_SQL["enable_pgvector"])
            await self._create_tables(conn)

        self._initialized = True

    async def _create_tables(self, conn: asyncpg.Connection) -> None:
        """Create all required database tables."""
        await conn.execute(SCHEMA_SQL["create_jobs_table"])
        await conn.execute(SCHEMA_SQL["create_job_executions_table"])

        for sql in SCHEMA_COMPAT_ALTER_SQL:
            await conn.execute(sql)

        await conn.execute(SCHEMA_SQL["idx_jobs_enabled"])
        await conn.execute(SCHEMA_SQL["idx_jobs_tenant_id_id"])
        await conn.execute(SCHEMA_SQL["idx_job_executions_job_id"])
        await conn.execute(SCHEMA_SQL["idx_job_executions_tenant_id_job_id"])
        await conn.execute(SCHEMA_SQL["idx_job_executions_status"])
        await self._initialize_runtime_state_schema(conn)
        await conn.execute(SCHEMA_SQL["create_embeddings_table"])
        await conn.execute(SCHEMA_SQL["idx_embeddings_vector"])
        await conn.execute(SCHEMA_SQL["idx_embeddings_tenant_id_id"])

    async def _initialize_runtime_state_schema(self, conn: asyncpg.Connection) -> None:
        """Initialize PostgreSQL tables for mutable runtime state."""
        # 1) Create tables first
        for sql in RUNTIME_STATE_SCHEMA_SQL:
            statement = sql.strip().upper()
            if statement.startswith("CREATE TABLE"):
                await conn.execute(sql)

        # 2) Apply compatibility alters
        for sql in RUNTIME_STATE_ALTER_SQL:
            await conn.execute(sql)

        # 3) Create indexes once required columns exist
        for sql in RUNTIME_STATE_SCHEMA_SQL:
            statement = sql.strip().upper()
            if statement.startswith("CREATE INDEX") or statement.startswith(
                "CREATE UNIQUE INDEX"
            ):
                await conn.execute(sql)

    @property
    def tenant_id(self) -> str:
        """Return the tenant identifier from bootstrap settings."""
        return bootstrap_settings.TENANT_ID

    async def save_job(self, job: "JobDefinition") -> None:
        """Persist a job definition to the database."""
        await self.initialize()
        await pg_save_job(self._pool, self.tenant_id, job)

    async def get_job(self, job_id: str) -> Optional["JobDefinition"]:
        """Retrieve a job definition from the database."""
        await self.initialize()
        return await pg_get_job(self._pool, self.tenant_id, job_id)

    async def list_jobs(self) -> list["JobDefinition"]:
        """Retrieve all job definitions from the database."""
        return await self.get_all_jobs()

    async def get_all_jobs(self) -> list["JobDefinition"]:
        """Retrieve all job definitions from the database."""
        await self.initialize()
        return await pg_get_all_jobs(self._pool, self.tenant_id)

    async def delete_job(self, job_id: str, hard_delete: bool = False) -> bool:
        """Delete a job definition from the database.

        Args:
            job_id: ID of the job to delete.
            hard_delete: If True, permanently remove the row.
        """
        await self.initialize()
        return await pg_delete_job(self._pool, self.tenant_id, job_id, hard_delete)

    async def save_job_execution(self, execution: "JobExecution") -> None:
        """Persist a job execution record to the database."""
        await self.initialize()
        await pg_save_job_execution(self._pool, self.tenant_id, execution)

    async def get_job_executions(
        self,
        job_id: str,
        limit: int = 10,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> tuple[list["JobExecution"], int]:
        """Retrieve execution history for a specific job."""
        await self.initialize()
        return await pg_get_job_executions(
            self._pool, self.tenant_id, job_id, limit, offset, status
        )

    async def get_recent_job_executions(
        self,
        limit: int = 50,
        offset: int = 0,
        job_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> tuple[list["JobExecution"], int]:
        """Retrieve recent executions across all jobs or a single job."""
        await self.initialize()
        return await pg_get_recent_job_executions(
            self._pool, self.tenant_id, limit, offset, job_id, status
        )

    async def get_job_metrics(self, job_id: str) -> dict:
        """Get execution metrics for a specific job."""
        await self.initialize()
        return await pg_get_job_metrics(self._pool, self.tenant_id, job_id)

    async def cleanup_old_job_executions(self, retention_days: int = 30) -> int:
        """Remove old job execution records."""
        await self.initialize()
        return await pg_cleanup_old_job_executions(
            self._pool, self.tenant_id, retention_days
        )

    async def save_embedding(
        self,
        content: str,
        embedding: list[float],
        metadata: Optional[dict] = None,
    ) -> int:
        """Save an embedding vector to the database."""
        await self.initialize()
        return await pg_save_embedding(
            self._pool, self.tenant_id, content, embedding, metadata
        )

    async def search_similar_embeddings(
        self,
        query_embedding: list[float],
        limit: int = 10,
        similarity_threshold: float = 0.7,
    ) -> list[dict]:
        """Search for similar embeddings using vector similarity."""
        await self.initialize()
        return await pg_search_similar_embeddings(
            self._pool, self.tenant_id, query_embedding, limit, similarity_threshold
        )

    async def get_overall_job_metrics(self) -> dict:
        """Get aggregated execution metrics across all jobs."""
        await self.initialize()
        return await pg_get_overall_job_metrics(self._pool, self.tenant_id)

    async def close(self) -> None:
        """Close the connection pool."""
        if self._pool:
            await self._pool.close()
            self._pool = None

    @property
    def pool(self) -> asyncpg.Pool:
        """Return the initialized PostgreSQL pool.

        Raises:
            RuntimeError: If the pool has not been initialized yet.
        """
        if self._pool is None:
            raise RuntimeError("PostgreSQL pool is not initialized")

        return self._pool
