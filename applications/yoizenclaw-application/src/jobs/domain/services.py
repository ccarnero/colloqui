"""Domain services for job business logic.

Contains pure business logic and domain services.
"""

from __future__ import annotations

from typing import Optional

from src.jobs.domain.entities import JobDefinition, JobExecution, JobExecutionStatus


class JobDomainService:
    """Domain service for job-related business logic."""

    @staticmethod
    def can_execute_job(job: JobDefinition) -> bool:
        """Check if a job can be executed based on its state."""
        return job.enabled

    @staticmethod
    def should_retry_execution(execution: JobExecution, job: JobDefinition) -> bool:
        """Determine if a failed execution should be retried."""
        if execution.status != JobExecutionStatus.FAILED:
            return False
        
        return execution.retry_count < job.retry_policy.max_retries

    @staticmethod
    def calculate_retry_delay(execution: JobExecution, job: JobDefinition) -> int:
        """Calculate delay before next retry attempt."""
        policy = job.retry_policy
        base_delay = policy.delay_seconds
        
        if policy.backoff == "none":
            return base_delay
        elif policy.backoff == "linear":
            return base_delay * (execution.retry_count + 1)
        elif policy.backoff == "exponential":
            return base_delay * (2 ** execution.retry_count)
        
        return base_delay

    @staticmethod
    def validate_job_definition(job: JobDefinition) -> list[str]:
        """Validate a job definition and return any errors."""
        errors = []
        
        if not job.name.strip():
            errors.append("Job name cannot be empty")
        
        if job.schedule_type == "cron":
            if "expression" not in job.schedule_config:
                errors.append("Cron schedule requires 'expression' in schedule_config")
        elif job.schedule_type == "interval":
            if "seconds" not in job.schedule_config:
                errors.append("Interval schedule requires 'seconds' in schedule_config")
        
        if job.action_type == "llm_call":
            if "prompt" not in job.action_config:
                errors.append("LLM call action requires 'prompt' in action_config")
        elif job.action_type == "webhook":
            if "url" not in job.action_config:
                errors.append("Webhook action requires 'url' in action_config")
        
        return errors

    @staticmethod
    def create_execution_from_job(job: JobDefinition) -> JobExecution:
        """Create a new execution record for a job."""
        return JobExecution(
            job_id=job.id,
            status=JobExecutionStatus.PENDING
        )
