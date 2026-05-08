"""Error classes for YoizenClaw.

Usage:
    from src.utils.errors import JobError, WebhookError

    raise JobError("Job failed", job_id="123")
"""

from src.utils.errors.base import (
    ConfigurationError,
    InvalidFieldError,
    RequiredFieldMissingError,
    RuntimeNotConfiguredError,
    YoizenClawError,
)
from src.utils.errors.job import (
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
