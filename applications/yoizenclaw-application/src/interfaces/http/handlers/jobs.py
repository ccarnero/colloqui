"""Jobs management handlers for YoizenClaw API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.jobs.domain.entities import (
    JobDefinition,
    JobExecution,
    JobMetrics,
)
from src.jobs.scheduler import get_job_scheduler

router = APIRouter()


class JobListResponse(BaseModel):
    """Response model for listing jobs."""

    data: list[JobDefinition]
    total: int = 0
    limit: int = 50
    offset: int = 0


class JobResponse(BaseModel):
    """Response model for a single job."""

    data: JobDefinition


class JobExecutionListResponse(BaseModel):
    """Response model for job execution history."""

    data: list[JobExecution]
    total: int = 0
    limit: int = 50
    offset: int = 0


class JobMetricsResponse(BaseModel):
    """Response model for aggregated metrics."""

    data: JobMetrics


class TriggerJobRequest(BaseModel):
    """Request payload for manually triggering a job."""

    event_payload: dict[str, Any] | None = None


class TriggerJobResponse(BaseModel):
    """Response model for manual job triggers."""

    data: JobExecution


class EmitEventRequest(BaseModel):
    """Request payload for emitting an event-driven job trigger."""

    event_name: str = Field(min_length=1)
    event_payload: dict[str, Any] = Field(default_factory=dict)


class EmitEventResponse(BaseModel):
    """Response model for event emission."""

    success: bool
    event_name: str
    triggered_jobs: int


class OperationStatusResponse(BaseModel):
    """Response model for enable, disable, and delete operations."""

    success: bool
    status: str
    message: str


def _get_scheduler_or_raise():
    scheduler = get_job_scheduler()
    if scheduler is None:
        raise HTTPException(
            status_code=503,
            detail="Job scheduler not initialized",
        )
    return scheduler


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> JobListResponse:
    """List all configured jobs with pagination."""

    scheduler = _get_scheduler_or_raise()
    jobs, total = await scheduler.get_all_jobs(limit=limit, offset=offset)
    return JobListResponse(data=jobs, total=total, limit=limit, offset=offset)


@router.get("/jobs/executions", response_model=JobExecutionListResponse)
async def list_job_executions(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    job_id: str | None = None,
    status: str | None = None,
) -> JobExecutionListResponse:
    """List recent executions across all jobs or a single job."""

    scheduler = _get_scheduler_or_raise()
    executions, total = await scheduler.get_recent_job_executions(
        limit=limit,
        offset=offset,
        job_id=job_id,
        status=status,
    )
    return JobExecutionListResponse(data=executions, total=total, limit=limit, offset=offset)


@router.get("/jobs/metrics", response_model=JobMetricsResponse)
async def get_job_metrics(job_id: str | None = None) -> JobMetricsResponse:
    """Get job metrics for one job or all jobs."""

    scheduler = _get_scheduler_or_raise()
    metrics_data = (
        await scheduler.get_job_metrics(job_id)
        if job_id
        else await scheduler.get_overall_job_metrics()
    )
    return JobMetricsResponse(data=JobMetrics(**metrics_data))


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    """Get a single job by ID."""

    scheduler = _get_scheduler_or_raise()
    job = await scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(data=job)


@router.get("/jobs/{job_id}/executions", response_model=JobExecutionListResponse)
async def get_job_executions(
    job_id: str,
    limit: int = Query(default=20, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> JobExecutionListResponse:
    """Get execution history for a specific job."""

    scheduler = _get_scheduler_or_raise()
    job = await scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    executions, total = await scheduler.get_job_executions(job_id, limit=limit, offset=offset)
    return JobExecutionListResponse(data=executions, total=total, limit=limit, offset=offset)


@router.get("/jobs/{job_id}/metrics", response_model=JobMetricsResponse)
async def get_single_job_metrics(job_id: str) -> JobMetricsResponse:
    """Get metrics for a specific job."""

    scheduler = _get_scheduler_or_raise()
    job = await scheduler.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    metrics_data = await scheduler.get_job_metrics(job_id)
    return JobMetricsResponse(data=JobMetrics(**metrics_data))


@router.post("/jobs", response_model=JobResponse)
async def create_job(job: JobDefinition) -> JobResponse:
    """Create a new job."""

    scheduler = _get_scheduler_or_raise()
    existing = await scheduler.get_job(job.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Job already exists")
    try:
        await scheduler.add_job(job)
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={"error": "PERSISTENCE_ERROR", "message": f"Failed to persist job: {error}"},
        )
    stored = await scheduler.get_job(job.id)
    if stored is None:
        raise HTTPException(status_code=500, detail="Failed to create job")
    return JobResponse(data=stored)


@router.put("/jobs/{job_id}", response_model=JobResponse)
async def update_job(job_id: str, job: JobDefinition) -> JobResponse:
    """Update an existing job."""

    scheduler = _get_scheduler_or_raise()
    existing = await scheduler.get_job(job_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Job not found")

    updated_job = job.model_copy(update={"id": job_id})
    updated = await scheduler.update_job(updated_job)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update job")

    stored = await scheduler.get_job(job_id)
    if stored is None:
        raise HTTPException(status_code=500, detail="Failed to load updated job")
    return JobResponse(data=stored)


@router.delete("/jobs/{job_id}", response_model=OperationStatusResponse)
async def delete_job(job_id: str) -> OperationStatusResponse:
    """Delete a job."""

    scheduler = _get_scheduler_or_raise()
    deleted = await scheduler.remove_job(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found")
    return OperationStatusResponse(
        success=True,
        status="deleted",
        message="Job deleted",
    )


@router.post("/jobs/{job_id}/trigger", response_model=TriggerJobResponse)
async def trigger_job(
    job_id: str,
    request: TriggerJobRequest,
) -> TriggerJobResponse:
    """Manually trigger a job."""

    scheduler = _get_scheduler_or_raise()
    execution = await scheduler.trigger_job(job_id, request.event_payload)
    if execution is None:
        raise HTTPException(status_code=404, detail="Job not found or disabled")
    return TriggerJobResponse(data=execution)


@router.post("/jobs/events/emit", response_model=EmitEventResponse)
async def emit_job_event(request: EmitEventRequest) -> EmitEventResponse:
    """Emit an event to trigger event-driven jobs."""

    scheduler = _get_scheduler_or_raise()
    triggered_jobs = await scheduler.emit_event(
        request.event_name,
        request.event_payload,
    )
    return EmitEventResponse(
        success=True,
        event_name=request.event_name,
        triggered_jobs=triggered_jobs,
    )


@router.post("/jobs/{job_id}/enable", response_model=OperationStatusResponse)
async def enable_job(job_id: str) -> OperationStatusResponse:
    """Enable a disabled job."""

    scheduler = _get_scheduler_or_raise()
    enabled = await scheduler.enable_job(job_id)
    if not enabled:
        raise HTTPException(status_code=404, detail="Job not found")
    return OperationStatusResponse(
        success=True,
        status="enabled",
        message="Job enabled",
    )


@router.post("/jobs/{job_id}/disable", response_model=OperationStatusResponse)
async def disable_job(job_id: str) -> OperationStatusResponse:
    """Disable a job."""

    scheduler = _get_scheduler_or_raise()
    disabled = await scheduler.disable_job(job_id)
    if not disabled:
        raise HTTPException(status_code=404, detail="Job not found")
    return OperationStatusResponse(
        success=True,
        status="disabled",
        message="Job disabled",
    )
