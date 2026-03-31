"""Error classes for YoizenClaw.

Usage:
    from src.shared.errors import JobError, WebhookError

    raise JobError("Job failed", job_id="123")
"""

from src.shared.errors.base import (
    ConfigurationError,
    InvalidFieldError,
    RequiredFieldMissingError,
    RuntimeNotConfiguredError,
    YoizenClawError,
)
from src.shared.errors.job import (
    CodeExecutionError,
    JobError,
    JobExecutionError,
    JobNotFoundError,
    JobValidationError,
    WebhookError,
    WebhookTimeoutError,
)

__all__ = [
    "YoizenClawError",
    "ConfigurationError",
    "RequiredFieldMissingError",
    "InvalidFieldError",
    "RuntimeNotConfiguredError",
    "JobError",
    "JobNotFoundError",
    "JobExecutionError",
    "JobValidationError",
    "WebhookError",
    "WebhookTimeoutError",
    "CodeExecutionError",
]
