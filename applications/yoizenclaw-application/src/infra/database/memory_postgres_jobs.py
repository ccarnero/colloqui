"""Job-related PostgreSQL queries.

Provides job persistence and execution query methods.
"""

import json
import logging
from datetime import datetime
from typing import Optional, TYPE_CHECKING

import asyncpg

if TYPE_CHECKING:
    from src.services.domain.entities import JobDefinition, JobExecution

logger = logging.getLogger(__name__)


def _decode_jsonb(value: object, default: object) -> object:
    """Decode a JSONB value that may be a dict, list, or legacy JSON string."""
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _parse_json_value(value: object, default: object) -> object:
    if value in (None, ""):
        return default

    if isinstance(value, (dict, list)):
        return value

    if not isinstance(value, str):
        return default

    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _parse_datetime(value: object) -> datetime | None:
    if value in (None, ""):
        return None

    if isinstance(value, datetime):
        return value

    if not isinstance(value, str):
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _map_status_to_model(status_str: str) -> "JobExecutionStatus":
    from src.services.domain.entities import JobExecutionStatus

    mapping = {
        "pending": JobExecutionStatus.PENDING,
        "running": JobExecutionStatus.RUNNING,
        "completed": JobExecutionStatus.COMPLETED,
        "failed": JobExecutionStatus.FAILED,
        "cancelled": JobExecutionStatus.CANCELLED,
        "skipped": JobExecutionStatus.SKIPPED,
        "success": JobExecutionStatus.COMPLETED,
    }
    return mapping.get(status_str, JobExecutionStatus.PENDING)


def _serialize_status(status: "JobExecutionStatus") -> str:
    if isinstance(status, str):
        return status
    return status.value


def _row_to_job_execution(row: object) -> Optional["JobExecution"]:
    from src.services.domain.entities import JobExecution

    try:
        event_payload = _parse_json_value(row["event_payload"], None)
        result = _parse_json_value(row["result"], None)
        logs = _parse_json_value(row["logs"], [])

        if not isinstance(logs, list):
            logs = []

        return JobExecution(
            id=row["id"],
            job_id=row["job_id"],
            status=_map_status_to_model(row["status"]),
            triggered_by=row["triggered_by"],
            event_payload=event_payload if isinstance(event_payload, dict) else None,
            started_at=_parse_datetime(row["started_at"]),
            finished_at=_parse_datetime(row["finished_at"]),
            result=result if isinstance(result, dict) else None,
            error_message=row["error_message"],
            logs=[str(entry) for entry in logs],
            retry_count=row["retry_count"],
        )
    except (KeyError, TypeError, ValueError) as error:
        logger.warning(
            "Skipping malformed job execution row %s: %s",
            row["id"],
            error,
        )
        return None


async def save_job(
    pool: asyncpg.Pool,
    tenant_id: str,
    job: "JobDefinition",
) -> None:
    """Persist a job definition to the database."""
    created_at = job.created_at if isinstance(job.created_at, datetime) else datetime.fromisoformat(str(job.created_at))
    updated_at = job.updated_at if isinstance(job.updated_at, datetime) else datetime.fromisoformat(str(job.updated_at))

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO runtime_jobs
            (id, tenant_id, name, description, enabled, schedule_type,
             schedule_config, action_type, action_config, retry_policy,
             timeout_seconds, tags, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                enabled = EXCLUDED.enabled,
                schedule_type = EXCLUDED.schedule_type,
                schedule_config = EXCLUDED.schedule_config,
                action_type = EXCLUDED.action_type,
                action_config = EXCLUDED.action_config,
                retry_policy = EXCLUDED.retry_policy,
                timeout_seconds = EXCLUDED.timeout_seconds,
                tags = EXCLUDED.tags,
                updated_at = EXCLUDED.updated_at
            """,
            job.id,
            tenant_id,
            job.name,
            job.description,
            job.enabled,
            job.schedule_type,
            job.schedule_config,
            job.action_type,
            job.action_config,
            job.retry_policy.model_dump(),
            job.timeout_seconds,
            job.tags,
            created_at,
            updated_at,
        )


async def get_job(
    pool: asyncpg.Pool,
    tenant_id: str,
    job_id: str,
) -> Optional["JobDefinition"]:
    """Retrieve a job definition from the database."""
    from src.services.domain.entities import JobDefinition, RetryPolicy

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM runtime_jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
            job_id,
            tenant_id,
        )

    if not row:
        return None

    return JobDefinition(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        enabled=row["enabled"],
        schedule_type=row["schedule_type"],
        schedule_config=_decode_jsonb(row["schedule_config"], {}),
        action_type=row["action_type"],
        action_config=_decode_jsonb(row["action_config"], {}),
        retry_policy=RetryPolicy(**_decode_jsonb(row["retry_policy"], {})),
        timeout_seconds=row["timeout_seconds"],
        tags=_decode_jsonb(row["tags"], []) or [],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def get_all_jobs(
    pool: asyncpg.Pool,
    tenant_id: str,
) -> list["JobDefinition"]:
    """Retrieve all job definitions for the given tenant."""
    from src.services.domain.entities import JobDefinition, RetryPolicy

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM runtime_jobs WHERE tenant_id = $1 AND deleted_at IS NULL",
            tenant_id,
        )

    return [
        JobDefinition(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            enabled=row["enabled"],
            schedule_type=row["schedule_type"],
            schedule_config=_decode_jsonb(row["schedule_config"], {}),
            action_type=row["action_type"],
            action_config=_decode_jsonb(row["action_config"], {}),
            retry_policy=RetryPolicy(**_decode_jsonb(row["retry_policy"], {})),
            timeout_seconds=row["timeout_seconds"],
            tags=_decode_jsonb(row["tags"], []) or [],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


async def delete_job(
    pool: asyncpg.Pool,
    tenant_id: str,
    job_id: str,
    hard_delete: bool = False,
) -> bool:
    """Delete a job definition from the database.

    Args:
        pool: PostgreSQL connection pool.
        tenant_id: Tenant identifier for row-level isolation.
        job_id: ID of the job to delete.
        hard_delete: If True, permanently remove the row.

    Returns:
        True if a row was affected.
    """
    async with pool.acquire() as conn:
        if hard_delete:
            result = await conn.execute(
                "DELETE FROM runtime_jobs WHERE id = $1 AND tenant_id = $2",
                job_id,
                tenant_id,
            )
        else:
            result = await conn.execute(
                "UPDATE runtime_jobs SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
                job_id,
                tenant_id,
            )
        return int(result.split()[-1]) > 0


async def save_job_execution(
    pool: asyncpg.Pool,
    tenant_id: str,
    execution: "JobExecution",
) -> None:
    """Persist a job execution record to the database."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO runtime_job_executions
            (id, tenant_id, job_id, status, triggered_by, event_payload,
             started_at, finished_at, result, error_message, logs, retry_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                started_at = EXCLUDED.started_at,
                finished_at = EXCLUDED.finished_at,
                result = EXCLUDED.result,
                error_message = EXCLUDED.error_message,
                logs = EXCLUDED.logs,
                retry_count = EXCLUDED.retry_count
            """,
            execution.id,
            tenant_id,
            execution.job_id,
            _serialize_status(execution.status),
            execution.triggered_by,
            execution.event_payload if execution.event_payload else None,
            execution.started_at,
            execution.finished_at,
            execution.result if execution.result else None,
            execution.error_message,
            execution.logs if execution.logs else None,
            execution.retry_count,
        )


async def get_job_executions(
    pool: asyncpg.Pool,
    tenant_id: str,
    job_id: str,
    limit: int = 10,
    offset: int = 0,
    status: Optional[str] = None,
) -> tuple[list["JobExecution"], int]:
    """Retrieve execution history for a specific job."""
    from src.services.domain.entities import JobExecution

    async with pool.acquire() as conn:
        count_query = (
            "SELECT COUNT(*) FROM runtime_job_executions"
            " WHERE job_id = $1 AND tenant_id = $2"
        )
        count_params: list[object] = [job_id, tenant_id]
        if status:
            count_query += " AND status = $3"
            count_params.append(status)

        total = await conn.fetchval(count_query, *count_params)

        if status:
            rows = await conn.fetch(
                """
                SELECT * FROM runtime_job_executions
                WHERE job_id = $1 AND tenant_id = $2 AND status = $3
                ORDER BY started_at DESC
                LIMIT $4 OFFSET $5
                """,
                job_id, tenant_id, status, limit, offset,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM runtime_job_executions
                WHERE job_id = $1 AND tenant_id = $2
                ORDER BY started_at DESC
                LIMIT $3 OFFSET $4
                """,
                job_id, tenant_id, limit, offset,
            )

    executions: list[JobExecution] = []
    for row in rows:
        execution = _row_to_job_execution(row)
        if execution is None:
            continue
        executions.append(execution)

    return executions, total


async def get_recent_job_executions(
    pool: asyncpg.Pool,
    tenant_id: str,
    limit: int = 50,
    offset: int = 0,
    job_id: Optional[str] = None,
    status: Optional[str] = None,
) -> tuple[list["JobExecution"], int]:
    """Retrieve recent executions across all jobs or a single job."""
    from src.services.domain.entities import JobExecution

    count_query = "SELECT COUNT(*) FROM runtime_job_executions"
    count_conditions: list[str] = []
    count_params: list[object] = [tenant_id]
    count_conditions.append("tenant_id = $1")

    if job_id:
        count_params.append(job_id)
        count_conditions.append(f"job_id = ${len(count_params)}")

    if status:
        count_params.append(status)
        count_conditions.append(f"status = ${len(count_params)}")

    if count_conditions:
        count_query = f"{count_query} WHERE {' AND '.join(count_conditions)}"

    async with pool.acquire() as conn:
        total = await conn.fetchval(count_query, *count_params)

    data_query = "SELECT * FROM runtime_job_executions"
    data_conditions: list[str] = []
    params: list[object] = [tenant_id]
    data_conditions.append("tenant_id = $1")

    if job_id:
        params.append(job_id)
        data_conditions.append(f"job_id = ${len(params)}")

    if status:
        params.append(status)
        data_conditions.append(f"status = ${len(params)}")

    if data_conditions:
        data_query = f"{data_query} WHERE {' AND '.join(data_conditions)}"

    params.extend([limit, offset])
    data_query = (
        f"{data_query} ORDER BY COALESCE(started_at, finished_at) DESC "
        f"LIMIT ${len(params) - 1} OFFSET ${len(params)}"
    )

    async with pool.acquire() as conn:
        rows = await conn.fetch(data_query, *params)

    executions: list[JobExecution] = []
    for row in rows:
        execution = _row_to_job_execution(row)
        if execution is None:
            continue
        executions.append(execution)

    return executions, total


def _compute_metrics(row: asyncpg.Record) -> dict:
    """Compute metrics dictionary from a metrics query row."""
    total = row["total"] or 0
    successful = row["successful"] or 0
    failed = row["failed"] or 0
    cancelled = row["cancelled"] or 0
    skipped = row["skipped"] or 0
    avg_duration = row["avg_duration"] or 0.0

    return {
        "total_executions": total,
        "successful": successful,
        "failed": failed,
        "cancelled": cancelled,
        "skipped": skipped,
        "avg_duration_seconds": avg_duration,
        "success_rate": (successful / total * 100) if total > 0 else 0.0,
    }


async def get_job_metrics(
    pool: asyncpg.Pool,
    tenant_id: str,
    job_id: str,
) -> dict:
    """Get execution metrics for a specific job."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status IN ('completed', 'success')) as successful,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
                COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
                AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) as avg_duration
            FROM runtime_job_executions
            WHERE job_id = $1 AND tenant_id = $2
            """,
            job_id,
            tenant_id,
        )

    return _compute_metrics(row)


async def get_overall_job_metrics(
    pool: asyncpg.Pool,
    tenant_id: str,
) -> dict:
    """Get aggregated execution metrics across all jobs for a tenant."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status IN ('completed', 'success') THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
                AVG(
                    CASE
                        WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (finished_at - started_at))
                        ELSE NULL
                    END
                ) as avg_duration
            FROM runtime_job_executions
            WHERE tenant_id = $1
            """,
            tenant_id,
        )

    return _compute_metrics(row)


async def cleanup_old_job_executions(
    pool: asyncpg.Pool,
    tenant_id: str,
    retention_days: int = 30,
) -> int:
    """Remove old job execution records for a tenant."""
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM runtime_job_executions WHERE tenant_id = $1 AND started_at < NOW() - (INTERVAL '1 day' * $2)",
            tenant_id,
            retention_days,
        )
        return int(result.split()[-1])
