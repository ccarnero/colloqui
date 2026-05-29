"""Job-related MongoDB operations."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, TYPE_CHECKING

from motor.motor_asyncio import AsyncIOMotorDatabase

if TYPE_CHECKING:
    from src.services.domain.entities import JobDefinition, JobExecution

logger = logging.getLogger(__name__)


def _decode_json_value(value: object, default: object) -> object:
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


def _row_to_job_execution(document: dict[str, object]) -> Optional["JobExecution"]:
    from src.services.domain.entities import JobExecution

    try:
        event_payload = _decode_json_value(document.get("event_payload"), None)
        result = _decode_json_value(document.get("result"), None)
        logs = _decode_json_value(document.get("logs"), [])

        if not isinstance(logs, list):
            logs = []

        return JobExecution(
            id=str(document["id"]),
            job_id=str(document["job_id"]),
            status=_map_status_to_model(str(document["status"])),
            triggered_by=str(document["triggered_by"]),
            event_payload=event_payload if isinstance(event_payload, dict) else None,
            started_at=_parse_datetime(document.get("started_at")),
            finished_at=_parse_datetime(document.get("finished_at")),
            result=result if isinstance(result, dict) else None,
            error_message=document.get("error_message"),
            logs=[str(entry) for entry in logs],
            retry_count=int(document.get("retry_count", 0)),
        )
    except (KeyError, TypeError, ValueError) as error:
        logger.warning(
            "Skipping malformed job execution document %s: %s",
            document.get("id"),
            error,
        )
        return None


def _document_to_job(document: dict[str, object]) -> "JobDefinition":
    from src.services.domain.entities import JobDefinition, RetryPolicy

    return JobDefinition(
        id=str(document["id"]),
        name=str(document["name"]),
        description=document.get("description"),
        enabled=bool(document.get("enabled", True)),
        schedule_type=str(document["schedule_type"]),
        schedule_config=_decode_json_value(document.get("schedule_config"), {}),
        action_type=str(document["action_type"]),
        action_config=_decode_json_value(document.get("action_config"), {}),
        retry_policy=RetryPolicy(
            **_decode_json_value(document.get("retry_policy"), {}),
        ),
        timeout_seconds=int(document.get("timeout_seconds", 60)),
        tags=_decode_json_value(document.get("tags"), []) or [],
        created_at=_parse_datetime(document.get("created_at")) or datetime.now(timezone.utc),
        updated_at=_parse_datetime(document.get("updated_at")) or datetime.now(timezone.utc),
    )


async def save_job(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    job: "JobDefinition",
) -> None:
    """Persist a job definition to MongoDB."""

    created_at = (
        job.created_at
        if isinstance(job.created_at, datetime)
        else datetime.fromisoformat(str(job.created_at))
    )
    updated_at = (
        job.updated_at
        if isinstance(job.updated_at, datetime)
        else datetime.fromisoformat(str(job.updated_at))
    )

    await db.runtime_jobs.update_one(
        {"id": job.id, "tenant_id": tenant_id},
        {
            "$set": {
                "id": job.id,
                "tenant_id": tenant_id,
                "name": job.name,
                "description": job.description,
                "enabled": job.enabled,
                "schedule_type": job.schedule_type,
                "schedule_config": job.schedule_config,
                "action_type": job.action_type,
                "action_config": job.action_config,
                "retry_policy": job.retry_policy.model_dump(),
                "timeout_seconds": job.timeout_seconds,
                "tags": job.tags,
                "created_at": created_at,
                "updated_at": updated_at,
                "deleted_at": None,
            },
        },
        upsert=True,
    )


async def get_job(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    job_id: str,
) -> Optional["JobDefinition"]:
    """Retrieve a job definition from MongoDB."""

    document = await db.runtime_jobs.find_one(
        {
            "id": job_id,
            "tenant_id": tenant_id,
            "deleted_at": None,
        },
    )
    if document is None:
        return None

    return _document_to_job(document)


async def get_all_jobs(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
) -> list["JobDefinition"]:
    """Retrieve all job definitions for the given tenant."""

    cursor = db.runtime_jobs.find(
        {
            "tenant_id": tenant_id,
            "deleted_at": None,
        },
    )
    return [_document_to_job(document) async for document in cursor]


async def delete_job(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    job_id: str,
    hard_delete: bool = False,
) -> bool:
    """Delete a job definition from MongoDB."""

    if hard_delete:
        result = await db.runtime_jobs.delete_one(
            {"id": job_id, "tenant_id": tenant_id},
        )
        return result.deleted_count > 0

    result = await db.runtime_jobs.update_one(
        {
            "id": job_id,
            "tenant_id": tenant_id,
            "deleted_at": None,
        },
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    return result.modified_count > 0


async def save_job_execution(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    execution: "JobExecution",
) -> None:
    """Persist a job execution record to MongoDB."""

    await db.runtime_job_executions.update_one(
        {"id": execution.id, "tenant_id": tenant_id},
        {
            "$set": {
                "id": execution.id,
                "tenant_id": tenant_id,
                "job_id": execution.job_id,
                "status": _serialize_status(execution.status),
                "triggered_by": execution.triggered_by,
                "event_payload": execution.event_payload if execution.event_payload else None,
                "started_at": execution.started_at,
                "finished_at": execution.finished_at,
                "result": execution.result if execution.result else None,
                "error_message": execution.error_message,
                "logs": execution.logs if execution.logs else None,
                "retry_count": execution.retry_count,
            },
        },
        upsert=True,
    )


async def get_job_executions(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    job_id: str,
    limit: int = 10,
    offset: int = 0,
    status: Optional[str] = None,
) -> tuple[list["JobExecution"], int]:
    """Retrieve execution history for a specific job."""

    query: dict[str, object] = {
        "job_id": job_id,
        "tenant_id": tenant_id,
    }
    if status:
        query["status"] = status

    total = await db.runtime_job_executions.count_documents(query)
    cursor = (
        db.runtime_job_executions.find(query)
        .sort("started_at", -1)
        .skip(offset)
        .limit(limit)
    )

    executions: list["JobExecution"] = []
    async for document in cursor:
        execution = _row_to_job_execution(document)
        if execution is None:
            continue
        executions.append(execution)

    return executions, total


async def get_recent_job_executions(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    limit: int = 50,
    offset: int = 0,
    job_id: Optional[str] = None,
    status: Optional[str] = None,
) -> tuple[list["JobExecution"], int]:
    """Retrieve recent executions across all jobs or a single job."""

    query: dict[str, object] = {"tenant_id": tenant_id}
    if job_id:
        query["job_id"] = job_id
    if status:
        query["status"] = status

    total = await db.runtime_job_executions.count_documents(query)
    cursor = (
        db.runtime_job_executions.find(query)
        .sort([("started_at", -1), ("finished_at", -1)])
        .skip(offset)
        .limit(limit)
    )

    executions: list["JobExecution"] = []
    async for document in cursor:
        execution = _row_to_job_execution(document)
        if execution is None:
            continue
        executions.append(execution)

    return executions, total


def _compute_metrics(metrics: dict[str, object]) -> dict:
    total = int(metrics.get("total") or 0)
    successful = int(metrics.get("successful") or 0)
    failed = int(metrics.get("failed") or 0)
    cancelled = int(metrics.get("cancelled") or 0)
    skipped = int(metrics.get("skipped") or 0)
    avg_duration = float(metrics.get("avg_duration") or 0.0)

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
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    job_id: str,
) -> dict:
    """Get execution metrics for a specific job."""

    pipeline = [
        {"$match": {"job_id": job_id, "tenant_id": tenant_id}},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "successful": {
                    "$sum": {
                        "$cond": [
                            {"$in": ["$status", ["completed", "success"]]},
                            1,
                            0,
                        ],
                    },
                },
                "failed": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "failed"]}, 1, 0],
                    },
                },
                "cancelled": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "cancelled"]}, 1, 0],
                    },
                },
                "skipped": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "skipped"]}, 1, 0],
                    },
                },
                "avg_duration": {
                    "$avg": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$ne": ["$started_at", None]},
                                    {"$ne": ["$finished_at", None]},
                                ],
                            },
                            {
                                "$divide": [
                                    {"$subtract": ["$finished_at", "$started_at"]},
                                    1000,
                                ],
                            },
                            None,
                        ],
                    },
                },
            },
        },
    ]

    rows = await db.runtime_job_executions.aggregate(pipeline).to_list(length=1)
    if not rows:
        return _compute_metrics({})

    return _compute_metrics(rows[0])


async def get_overall_job_metrics(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
) -> dict:
    """Get aggregated execution metrics across all jobs for a tenant."""

    pipeline = [
        {"$match": {"tenant_id": tenant_id}},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "successful": {
                    "$sum": {
                        "$cond": [
                            {"$in": ["$status", ["completed", "success"]]},
                            1,
                            0,
                        ],
                    },
                },
                "failed": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "failed"]}, 1, 0],
                    },
                },
                "cancelled": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "cancelled"]}, 1, 0],
                    },
                },
                "skipped": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "skipped"]}, 1, 0],
                    },
                },
                "avg_duration": {
                    "$avg": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$ne": ["$started_at", None]},
                                    {"$ne": ["$finished_at", None]},
                                ],
                            },
                            {
                                "$divide": [
                                    {"$subtract": ["$finished_at", "$started_at"]},
                                    1000,
                                ],
                            },
                            None,
                        ],
                    },
                },
            },
        },
    ]

    rows = await db.runtime_job_executions.aggregate(pipeline).to_list(length=1)
    if not rows:
        return _compute_metrics({})

    return _compute_metrics(rows[0])


async def cleanup_old_job_executions(
    db: AsyncIOMotorDatabase,
    tenant_id: str,
    retention_days: int = 30,
) -> int:
    """Remove old job execution records for a tenant."""

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    result = await db.runtime_job_executions.delete_many(
        {
            "tenant_id": tenant_id,
            "started_at": {"$lt": cutoff},
        },
    )
    return result.deleted_count
