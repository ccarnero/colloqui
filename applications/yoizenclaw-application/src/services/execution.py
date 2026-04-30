"""Job execution logic for YoizenClaw scheduler.

Handles job execution with retry logic, error handling, and status reporting.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from opentelemetry import trace

from src.services.domain.entities import JobDefinition, JobExecution
from src.utils.telemetry import get_tracer, record_job_execution, record_job_duration

if TYPE_CHECKING:
    from src.services.executor import JobExecutor
    from src.core import create_memory

logger = logging.getLogger(__name__)
_tracer = get_tracer(__name__)


class JobExecutionEngine:
    """Handles job execution with retry logic and error handling."""

    def __init__(self, executor: JobExecutor, memory: Memory) -> None:
        """Initialize the execution engine.

        Args:
            executor: JobExecutor instance for executing job actions.
            memory: Memory instance for persisting execution records.
        """
        self._executor = executor
        self._memory = memory

    async def execute_job(
        self,
        job: JobDefinition,
        execution: JobExecution,
    ) -> None:
        """Execute a job and handle retries with instrumentation.

        Args:
            job: JobDefinition to execute.
            execution: JobExecution tracking record.
        """
        job_type = getattr(job, 'job_type', None) or 'unknown'
        triggered_by = execution.triggered_by or 'unknown'
        
        with _tracer.start_as_current_span("job.execute") as span:
            span.set_attribute("job.id", job.id)
            span.set_attribute("job.name", job.name)
            span.set_attribute("job.type", job_type)
            span.set_attribute("job.execution_id", execution.id)
            span.set_attribute("job.triggered_by", triggered_by)
            span.set_attribute("job.max_retries", job.retry_policy.max_retries)
            span.set_attribute("job.timeout_seconds", job.timeout_seconds)

            if not self._executor:
                logger.error("Cannot execute job %s: no executor set", job.id)
                span.set_status(trace.StatusCode.ERROR, "No executor set")
                return

            start_time = time.time()
            final_status = "error"

            # Execute with retry logic
            while execution.retry_count <= job.retry_policy.max_retries:
                try:
                    execution.start()
                    execution.add_log(f"Starting execution (attempt {execution.retry_count + 1})")
                    await self._memory.save_job_execution(execution)
                    await self._report_execution_status(execution, job)

                    span.set_attribute("job.attempt", execution.retry_count + 1)

                    result = await asyncio.wait_for(
                        self._executor.execute(job, execution),
                        timeout=job.timeout_seconds,
                    )

                    execution.complete(result)
                    execution.add_log("Execution completed successfully")
                    final_status = "success"
                    span.set_attribute("job.result.size", len(str(result)) if result else 0)
                    break

                except asyncio.TimeoutError:
                    execution.retry_count += 1
                    error_msg = f"Timeout after {job.timeout_seconds}s"
                    execution.add_log(error_msg)
                    span.set_attribute("job.timeout", True)
                    span.set_attribute("job.retry_count", execution.retry_count)

                    if execution.retry_count > job.retry_policy.max_retries:
                        execution.fail(error_msg)
                        final_status = "timeout"
                    else:
                        delay = self._calculate_retry_delay(job, execution.retry_count)
                        execution.add_log(f"Retrying in {delay}s...")
                        await asyncio.sleep(delay)

                except (KeyboardInterrupt, SystemExit):
                    raise
                except Exception as e:
                    execution.retry_count += 1
                    error_msg = str(e)
                    execution.add_log(f"Error: {error_msg}")
                    span.record_exception(e)
                    span.set_attribute("job.retry_count", execution.retry_count)
                    span.set_attribute("job.error", error_msg)

                    if execution.retry_count > job.retry_policy.max_retries:
                        execution.fail(error_msg)
                        final_status = "error"
                    else:
                        delay = self._calculate_retry_delay(job, execution.retry_count)
                        execution.add_log(f"Retrying in {delay}s...")
                        await asyncio.sleep(delay)

            # Calculate duration
            duration = time.time() - start_time

            # Record metrics
            record_job_execution(job_type, final_status)
            record_job_duration(duration, job_type, final_status)

            # Set final span attributes
            span.set_attribute("job.duration_seconds", duration)
            span.set_attribute("job.final_status", final_status)
            span.set_attribute("job.total_attempts", execution.retry_count + 1)
            
            if final_status == "success":
                span.set_status(trace.StatusCode.OK)
            else:
                span.set_status(trace.StatusCode.ERROR, f"Job failed: {final_status}")

            # Persist execution record
            await self._memory.save_job_execution(execution)

            # Report status to backend (via NATS)
            await self._report_execution_status(execution, job)

    def _calculate_retry_delay(self, job: JobDefinition, retry_count: int) -> float:
        """Calculate delay before next retry attempt.

        Args:
            job: Job definition with retry policy.
            retry_count: Current retry attempt number.

        Returns:
            Delay in seconds before next retry.
        """
        base_delay = job.retry_policy.delay_seconds

        if job.retry_policy.backoff == "none":
            return base_delay
        elif job.retry_policy.backoff == "linear":
            return base_delay * retry_count
        else:  # exponential
            return base_delay * (2 ** (retry_count - 1))

    async def _report_execution_status(
        self,
        execution: JobExecution,
        job: JobDefinition,
    ) -> None:
        """Report job execution status to admin via NATS.

        Args:
            execution: Completed JobExecution.
            job: JobDefinition that was executed.
        """
        try:
            from src.messaging.bridge import publish_job_execution_status

            await publish_job_execution_status(
                {
                    "error_message": execution.error_message,
                    "event_payload": execution.event_payload,
                    "finished_at": (
                        execution.finished_at.isoformat()
                        if execution.finished_at
                        else None
                    ),
                    "id": execution.id,
                    "job_id": execution.job_id,
                    "job_name": job.name,
                    "logs": execution.logs,
                    "result": execution.result,
                    "retry_count": execution.retry_count,
                    "started_at": (
                        execution.started_at.isoformat()
                        if execution.started_at
                        else None
                    ),
                    "status": execution.status,
                    "triggered_by": execution.triggered_by,
                }
            )
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as e:
            logger.warning("Failed to report job status: %s", e)

    async def trigger_event_jobs(
        self,
        event_name: str,
        payload: dict[str, Any],
        jobs: list[JobDefinition],
        execution_callback: callable,
    ) -> None:
        """Trigger jobs registered for a specific event with instrumentation.

        Args:
            event_name: Name of the event.
            payload: Event data payload.
            jobs: List of jobs to trigger.
            execution_callback: Callback to execute each job.
        """
        with _tracer.start_as_current_span("job.trigger_event") as span:
            span.set_attribute("event.name", event_name)
            span.set_attribute("event.jobs_count", len(jobs))
            span.set_attribute("event.payload_size", len(str(payload)))

            tasks: list[asyncio.Task] = []
            enabled_jobs = []
            
            for job in jobs:
                if job.enabled:
                    enabled_jobs.append(job)
                    execution = JobExecution(
                        job_id=job.id,
                        triggered_by="event",
                        event_payload=payload,
                    )
                    task = asyncio.create_task(self._safe_execute(job, execution, execution_callback))
                    tasks.append(task)

            span.set_attribute("event.enabled_jobs_count", len(enabled_jobs))

            if tasks:
                logger.debug("Emitted event '%s' to %d jobs", event_name, len(tasks))
                await asyncio.gather(*tasks, return_exceptions=True)
                
            span.set_attribute("event.completed_jobs", len(tasks))
            span.set_status(trace.StatusCode.OK)

    async def _safe_execute(
        self,
        job: JobDefinition,
        execution: JobExecution,
        callback: callable,
    ) -> None:
        """Execute callback with error logging.

        Args:
            job: JobDefinition to execute.
            execution: JobExecution tracking record.
            callback: Execution callback function.
        """
        try:
            await callback(job, execution)
        except Exception as e:
            logger.error("Event job %s failed: %s", job.id, e)
