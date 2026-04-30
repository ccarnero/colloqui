"""Domain entities for job management.

Contains pure business entities without external dependencies.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


class RetryPolicy(BaseModel):
    """Configuration for job retry behavior."""

    max_retries: int = Field(default=3, ge=0, le=10)
    delay_seconds: int = Field(default=60, ge=0)
    backoff: Literal["none", "linear", "exponential"] = "exponential"


class JobDefinition(BaseModel):
    """Complete definition of a scheduled job.

    Jobs can be triggered by schedule (cron/interval), events, or manually.
    Actions can call LLM, execute Python code, make webhooks, or call functions.
    """

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: Optional[str] = None
    enabled: bool = True
    schedule_type: Literal["cron", "interval", "event", "manual"]
    schedule_config: dict[str, Any]
    action_type: Literal["llm_call", "python_code", "webhook", "function", "pipeline"]
    action_config: dict[str, Any]
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    timeout_seconds: int = Field(default=60, ge=1, le=3600)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deleted_at: Optional[datetime] = None


class JobExecutionStatus(str, Enum):
    """Status of a job execution."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"


class JobExecution(BaseModel):
    """Record of a job execution."""

    model_config = {"use_enum_values": True}

    id: str = Field(default_factory=lambda: str(uuid4()))
    job_id: str
    status: JobExecutionStatus = JobExecutionStatus.PENDING
    triggered_by: Optional[str] = None
    event_payload: Optional[dict[str, Any]] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    logs: list[str] = Field(default_factory=list)
    retry_count: int = 0

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, v: object) -> object:
        """Coerce legacy 'success' DB value to 'completed'."""
        if v == "success":
            return "completed"
        return v

    def start(self) -> None:
        """Mark execution as running and record start time."""
        self.status = JobExecutionStatus.RUNNING  # type: ignore[assignment]
        self.started_at = datetime.now(timezone.utc)

    def complete(self, result: Optional[dict[str, Any]] = None) -> None:
        """Mark execution as completed."""
        self.status = JobExecutionStatus.COMPLETED  # type: ignore[assignment]
        self.finished_at = datetime.now(timezone.utc)
        self.result = result

    def fail(self, error_message: str) -> None:
        """Mark execution as failed."""
        self.status = JobExecutionStatus.FAILED  # type: ignore[assignment]
        self.finished_at = datetime.now(timezone.utc)
        self.error_message = error_message

    def add_log(self, message: str) -> None:
        """Append a log entry to the execution record."""
        self.logs.append(message)


class JobSyncPayload(BaseModel):
    """Payload for syncing jobs from backend."""

    jobs: list[JobDefinition]
    replace_all: bool = True
    deleted_job_ids: list[str] = Field(default_factory=list)


class JobTriggerPayload(BaseModel):
    """Payload for triggering a job execution."""

    job_id: str
    execution_id: str | None = None
    event_payload: dict[str, Any] = Field(default_factory=dict)


class JobEventPayload(BaseModel):
    """Payload for emitting an event-driven job trigger."""

    event_name: str
    event_payload: dict[str, Any] = Field(default_factory=dict)


class JobMetrics(BaseModel):
    """Job execution metrics."""

    total_executions: int = 0
    successful: int = 0
    failed: int = 0
    cancelled: int = 0
    skipped: int = 0
    avg_duration_seconds: float = 0.0
    success_rate: float = 0.0
