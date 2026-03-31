"""Tests for job domain entities and services."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.jobs.domain.entities import (
    JobDefinition,
    JobExecution,
    JobExecutionStatus,
    RetryPolicy,
)
from src.jobs.domain.services import JobDomainService


class TestRetryPolicy:
    """Test suite for RetryPolicy defaults."""

    def test_defaults(self) -> None:
        policy = RetryPolicy()
        assert policy.max_retries == 3
        assert policy.delay_seconds == 60
        assert policy.backoff == "exponential"

    def test_custom_values(self) -> None:
        policy = RetryPolicy(max_retries=5, delay_seconds=30, backoff="linear")
        assert policy.max_retries == 5
        assert policy.delay_seconds == 30
        assert policy.backoff == "linear"

    def test_max_retries_clamped(self) -> None:
        with pytest.raises(Exception):
            RetryPolicy(max_retries=11)

    def test_negative_delay_rejected(self) -> None:
        with pytest.raises(Exception):
            RetryPolicy(delay_seconds=-1)


class TestJobDefinition:
    """Test suite for JobDefinition entity."""

    def test_create_with_valid_data(self) -> None:
        job = JobDefinition(
            name="Test Job",
            schedule_type="cron",
            schedule_config={"expression": "0 * * * *"},
            action_type="webhook",
            action_config={"url": "https://example.com"},
        )
        assert job.name == "Test Job"
        assert job.schedule_type == "cron"
        assert job.action_type == "webhook"
        assert job.enabled is True
        assert job.timeout_seconds == 60
        assert job.deleted_at is None
        assert isinstance(job.id, str)
        assert len(job.id) > 0
        assert isinstance(job.created_at, datetime)
        assert isinstance(job.updated_at, datetime)

    def test_default_retry_policy(self) -> None:
        job = JobDefinition(
            name="Job",
            schedule_type="manual",
            schedule_config={},
            action_type="function",
            action_config={},
        )
        assert isinstance(job.retry_policy, RetryPolicy)
        assert job.retry_policy.max_retries == 3


class TestJobExecution:
    """Test suite for JobExecution entity."""

    def test_create_with_defaults(self) -> None:
        execution = JobExecution(job_id="job-1")
        assert execution.job_id == "job-1"
        assert execution.status == JobExecutionStatus.PENDING
        assert execution.started_at is None
        assert execution.finished_at is None
        assert execution.result is None
        assert execution.error_message is None
        assert execution.logs == []
        assert execution.retry_count == 0

    def test_start(self) -> None:
        execution = JobExecution(job_id="job-1")
        execution.start()
        assert execution.status == JobExecutionStatus.RUNNING
        assert execution.started_at is not None

    def test_complete(self) -> None:
        execution = JobExecution(job_id="job-1")
        execution.start()
        execution.complete(result={"ok": True})
        assert execution.status == JobExecutionStatus.COMPLETED
        assert execution.finished_at is not None
        assert execution.result == {"ok": True}

    def test_complete_without_result(self) -> None:
        execution = JobExecution(job_id="job-1")
        execution.start()
        execution.complete()
        assert execution.status == JobExecutionStatus.COMPLETED
        assert execution.result is None

    def test_fail(self) -> None:
        execution = JobExecution(job_id="job-1")
        execution.start()
        execution.fail("something went wrong")
        assert execution.status == JobExecutionStatus.FAILED
        assert execution.finished_at is not None
        assert execution.error_message == "something went wrong"

    def test_add_log(self) -> None:
        execution = JobExecution(job_id="job-1")
        execution.add_log("step 1 done")
        execution.add_log("step 2 done")
        assert execution.logs == ["step 1 done", "step 2 done"]

    def test_normalize_success_status(self) -> None:
        execution = JobExecution(job_id="job-1", status="success")
        assert execution.status == "completed"


class TestJobDomainService:
    """Test suite for JobDomainService static methods."""

    def _make_job(self, **overrides: object) -> JobDefinition:
        defaults: dict[str, object] = {
            "name": "Test",
            "schedule_type": "manual",
            "schedule_config": {},
            "action_type": "function",
            "action_config": {},
        }
        defaults.update(overrides)
        return JobDefinition(**defaults)

    def test_can_execute_job_enabled(self) -> None:
        job = self._make_job(enabled=True)
        assert JobDomainService.can_execute_job(job) is True

    def test_can_execute_job_disabled(self) -> None:
        job = self._make_job(enabled=False)
        assert JobDomainService.can_execute_job(job) is False

    def test_should_retry_failed_below_max(self) -> None:
        job = self._make_job(retry_policy=RetryPolicy(max_retries=3))
        execution = JobExecution(
            job_id="job-1",
            status=JobExecutionStatus.FAILED,
            retry_count=1,
        )
        assert JobDomainService.should_retry_execution(execution, job) is True

    def test_should_retry_failed_at_max(self) -> None:
        job = self._make_job(retry_policy=RetryPolicy(max_retries=3))
        execution = JobExecution(
            job_id="job-1",
            status=JobExecutionStatus.FAILED,
            retry_count=3,
        )
        assert JobDomainService.should_retry_execution(execution, job) is False

    def test_should_not_retry_non_failed(self) -> None:
        job = self._make_job()
        execution = JobExecution(
            job_id="job-1",
            status=JobExecutionStatus.COMPLETED,
            retry_count=0,
        )
        assert JobDomainService.should_retry_execution(execution, job) is False

    def test_calculate_retry_delay_none(self) -> None:
        job = self._make_job(retry_policy=RetryPolicy(delay_seconds=60, backoff="none"))
        execution = JobExecution(job_id="job-1", retry_count=2)
        assert JobDomainService.calculate_retry_delay(execution, job) == 60

    def test_calculate_retry_delay_linear(self) -> None:
        job = self._make_job(retry_policy=RetryPolicy(delay_seconds=10, backoff="linear"))
        execution = JobExecution(job_id="job-1", retry_count=2)
        assert JobDomainService.calculate_retry_delay(execution, job) == 30

    def test_calculate_retry_delay_exponential(self) -> None:
        job = self._make_job(
            retry_policy=RetryPolicy(delay_seconds=10, backoff="exponential")
        )
        execution = JobExecution(job_id="job-1", retry_count=3)
        assert JobDomainService.calculate_retry_delay(execution, job) == 80

    def test_validate_job_definition_valid(self) -> None:
        job = self._make_job(
            schedule_type="cron",
            schedule_config={"expression": "0 * * * *"},
        )
        assert JobDomainService.validate_job_definition(job) == []

    def test_validate_job_definition_empty_name(self) -> None:
        job = self._make_job(name="  ")
        errors = JobDomainService.validate_job_definition(job)
        assert any("empty" in e.lower() for e in errors)

    def test_validate_job_definition_cron_missing_expression(self) -> None:
        job = self._make_job(schedule_type="cron", schedule_config={})
        errors = JobDomainService.validate_job_definition(job)
        assert any("expression" in e for e in errors)

    def test_validate_job_definition_interval_missing_seconds(self) -> None:
        job = self._make_job(schedule_type="interval", schedule_config={})
        errors = JobDomainService.validate_job_definition(job)
        assert any("seconds" in e for e in errors)

    def test_validate_job_definition_llm_missing_prompt(self) -> None:
        job = self._make_job(action_type="llm_call", action_config={})
        errors = JobDomainService.validate_job_definition(job)
        assert any("prompt" in e for e in errors)

    def test_validate_job_definition_webhook_missing_url(self) -> None:
        job = self._make_job(action_type="webhook", action_config={})
        errors = JobDomainService.validate_job_definition(job)
        assert any("url" in e for e in errors)

    def test_create_execution_from_job(self) -> None:
        job = self._make_job()
        execution = JobDomainService.create_execution_from_job(job)
        assert execution.job_id == job.id
        assert execution.status == JobExecutionStatus.PENDING
