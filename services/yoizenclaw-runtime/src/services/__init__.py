"""Jobs module — runtime job scheduling and execution engine.

Provides job scheduling (cron, interval, event, manual) and execution
(LLM calls, webhooks, Python code) with PostgreSQL persistence
and APScheduler-based triggers.

Architecture:
- domain/entities.py      — Pydantic models (JobDefinition, JobExecution, etc.)
- domain/repositories.py  — Abstract interfaces for testing
- domain/services.py      — Pure domain logic (validation, retry calculation)
- scheduler_core.py       — JobScheduler (active scheduler, APScheduler integration)
- triggers.py             — JobTriggerManager (cron/interval/event trigger handling)
- executor.py             — JobExecutor (action dispatch: LLM, webhook, code)
- execution.py            — JobExecutionEngine (retry logic, NATS status reporting)
- scheduler_leader.py     — Leader election factory (postgres advisory / mongo TTL)
"""

from src.services.domain.entities import (
    JobDefinition,
    JobEventPayload,
    JobExecution,
    JobSyncPayload,
)
from src.services.scheduler import (
    JobScheduler,
    create_job_scheduler,
    get_job_scheduler,
    start_job_scheduler,
    stop_job_scheduler,
)
from src.services.executor import JobExecutor
from src.services.execution import JobExecutionEngine
from src.services.triggers import JobTriggerManager

__all__ = [
    "JobDefinition",
    "JobEventPayload",
    "JobExecution",
    "JobSyncPayload",
    "JobScheduler",
    "JobExecutor",
    "JobExecutionEngine",
    "JobTriggerManager",
    "create_job_scheduler",
    "get_job_scheduler",
    "start_job_scheduler",
    "stop_job_scheduler",
]
